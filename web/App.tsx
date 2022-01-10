/* eslint-disable no-console */
import { h, Component } from 'preact';
import WA from 'matrix-widget-api';
import BridgeAPI from './BridgeAPI';
import { BridgeRoomState } from '../src/Widgets/BridgeWidgetInterface';
import ErrorPane from './components/ErrorPane';
import AdminSettings from './components/AdminSettings';
interface IState {
    error: string|null,
    busy: boolean,
    roomId?: string,
    roomState?: BridgeRoomState;
}

function parseFragment() {
    const fragmentString = (window.location.hash || "?");
    return new URLSearchParams(fragmentString.substring(Math.max(fragmentString.indexOf('?'), 0)));
}

function assertParam(fragment, name) {
    const val = fragment.get(name);
    if (!val) throw new Error(`${name} is not present in URL - cannot load widget`);
    return val;
}

export default class App extends Component<void, IState> {
  private widgetApi: WA.WidgetApi;
  private bridgeApi: BridgeAPI;

  constructor() {
    super();
    this.state = {
        error: null,
        busy: true,
    };
  }

  async componentDidMount() {
    try {
        // Start widgeting
        const qs = parseFragment();
        const widgetId = assertParam(qs, 'widgetId');
        const roomId = assertParam(qs, 'roomId');
        const accessToken = assertParam(qs, 'accessToken');
        // Fetch via config.
        this.bridgeApi = new BridgeAPI("http://localhost:5000", accessToken);
        await this.bridgeApi.verify();
        this.widgetApi = new WA.WidgetApi(widgetId);
        this.widgetApi.on("ready", () => {
            console.log("Widget ready:", this);
        });
        this.widgetApi.on(`action:${WA.WidgetApiToWidgetAction.NotifyCapabilities}`, (ev) => {
            console.log(ev.detail.data.approved);
            console.log(`${WA.WidgetApiToWidgetAction.NotifyCapabilities}`, ev);
        })
        this.widgetApi.on(`action:${WA.WidgetApiToWidgetAction.SendEvent}`, (ev) => {
            console.log(`${WA.WidgetApiToWidgetAction.SendEvent}`, ev);
        })
                // Start the widget as soon as possible too, otherwise the client might time us out.
        this.widgetApi.start();
        const roomState = await this.bridgeApi.state();
        console.log('Got state', roomState);
        this.setState({
            roomState,
            roomId,
            busy: false,
        });
    } catch (ex) {
        console.error(`Bridge verifiation failed:`, ex);
        this.setState({
            error: ex.message,
            busy: false,
        });
    }
  }

    render() {
        // Return the App component.
        let content;
        if (this.state.error) {
            content = <ErrorPane>{this.state.error}</ErrorPane>;
        } else if (this.state.roomState) {
            content = <AdminSettings bridgeApi={this.bridgeApi} roomState={this.state.roomState}></AdminSettings>;
        } else if (this.state.busy) {
            content = <div class="spinner"></div>;
        } else {
            content = <b>Invalid state</b>;
        }
        return (
            <div className="App">
                {content}
            </div>
        );
    }
}
