/* eslint-disable no-console */
import { h, Component } from 'preact';
import WA, { MatrixCapabilities } from 'matrix-widget-api';
import { BridgeAPI, BridgeAPIError } from './BridgeAPI';
import { BridgeRoomState } from '../src/Widgets/BridgeWidgetInterface';
import { ErrorPane } from './components/elements';
import AdminSettings from './components/AdminSettings';
import RoomConfigView from './components/RoomConfigView';

interface IMinimalState {
    error: string|null,
    busy: boolean,
}
interface ICompleteState extends IMinimalState {
    roomId: string,
    userId: string,
    roomState: BridgeRoomState,
    supportedServices: {
        [sectionName: string]: boolean;
    }
    kind: "invite"|"admin"|"roomConfig",
}

type IState = IMinimalState|ICompleteState;

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
        const widgetKind = qs.get('kind') as "invite"|"admin"|"roomConfig";
        // Fetch via config.
        this.widgetApi = new WA.WidgetApi(widgetId);
        this.widgetApi.requestCapability(MatrixCapabilities.RequiresClient);
        this.widgetApi.on("ready", () => {
            console.log("Widget ready:", this);
        });
        this.widgetApi.on(`action:${WA.WidgetApiToWidgetAction.NotifyCapabilities}`, (ev) => {
            console.log(`${WA.WidgetApiToWidgetAction.NotifyCapabilities}`, ev);
        })
        this.widgetApi.on(`action:${WA.WidgetApiToWidgetAction.SendEvent}`, (ev) => {
            console.log(`${WA.WidgetApiToWidgetAction.SendEvent}`, ev);
        })
        // Start the widget as soon as possible too, otherwise the client might time us out.
        this.widgetApi.start();

        // Assuming the hosted widget is on the same API path.
        const widgetApiUrl = new URL(`${window.location.origin}${window.location.pathname.replace("/widgetapi/v1/static", "")}`);
        this.bridgeApi = await BridgeAPI.getBridgeAPI(widgetApiUrl.toString(), this.widgetApi);
        const { userId } = await this.bridgeApi.verify();
        const roomState = widgetKind === "admin" ? await this.bridgeApi.state() : undefined;
        const supportedServices = await this.bridgeApi.getEnabledConfigSections();
        // Calling setState is ok because we've awaited a network request.
        // eslint-disable-next-line react/no-did-mount-set-state
        this.setState({
            userId,
            roomState,
            roomId,
            supportedServices,
            kind: widgetKind,
            busy: false,
        });
    } catch (ex) {
        console.error(`Failed to setup widget:`, ex);
        let error: string = ex.message;
        if (ex instanceof BridgeAPIError) {
            if (ex.errcode === "M_AS_BAD_OPENID") {
                error = "Could not contact your homeserver. Your instance may be misconfigured.";
            }
        }
        // Calling setState is ok because we've awaited a network request.
        // eslint-disable-next-line react/no-did-mount-set-state
        this.setState({
            error,
            busy: false,
        });
    }
  }

    render() {
        // Return the App component.
        let content;
        if (this.state.error) {
            content = <ErrorPane>{this.state.error}</ErrorPane>;
        } else if (this.state.busy) {
            content = <div class="spinner" />;
        }
        
        if ("kind" in this.state) {
            if (this.state.roomState && this.state.kind === "admin") {
                content = <AdminSettings bridgeApi={this.bridgeApi} roomState={this.state.roomState} />;
            } else if (this.state.kind === "invite") {
                // Fall through for now, we don't support invite widgets *just* yet.
            } else if (this.state.kind === "roomConfig") {
                content = <RoomConfigView
                    roomId={this.state.roomId}
                    supportedServices={this.state.supportedServices}
                    bridgeApi={this.bridgeApi}
                    widgetApi={this.widgetApi}
                 />;
            } 
        }

        if (!content) {
            console.warn("invalid state", this.state);
            content = <b>Invalid state</b>;
        }

        return (
            <div className="app">
                {content}
            </div>
        );
    }
}
