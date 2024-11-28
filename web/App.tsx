import { Component } from 'preact';
import WA, { MatrixCapabilities } from 'matrix-widget-api';
import { BridgeAPI, BridgeAPIError, EmbedType, embedTypeParameter } from './BridgeAPI';
import { BridgeRoomState } from '../src/Widgets/BridgeWidgetInterface';
import { LoadingSpinner } from './components/elements/LoadingSpinner';
import AdminSettings from './components/AdminSettings';
import RoomConfigView from './components/RoomConfigView';
import { Alert } from '@vector-im/compound-web';
import { BridgeContext } from './context';

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
    },
    serviceScope?: string,
    embedType: EmbedType,
    kind: "invite"|"admin"|"roomConfig",
    widgetApi: WA.WidgetApi,
    bridgeApi: BridgeAPI,
}

type IState = IMinimalState|ICompleteState;

function parseFragment() {
    const fragmentString = (window.location.hash || "?");
    return new URLSearchParams(fragmentString.substring(Math.max(fragmentString.indexOf('?'), 0)));
}

function assertParam(fragment: URLSearchParams, name: string) {
    const val = fragment.get(name);
    if (!val) throw new Error(`${name} is not present in URL - cannot load widget`);
    return val;
}

export default class App extends Component<void, IState> {
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
        const serviceScope = qs.get('serviceScope');
        const embedType = qs.get(embedTypeParameter);
        // Fetch via config.
        const widgetApi = new WA.WidgetApi(widgetId, '*');
        widgetApi.requestCapability(MatrixCapabilities.RequiresClient);
        const widgetReady = new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Communication timed out to your Matrix client. Your browser may be blocking access.')), 5000);
            widgetApi.on("ready", () => {
                clearTimeout(timeout);
                resolve();
            });
        });
        widgetApi.on(`action:${WA.WidgetApiToWidgetAction.NotifyCapabilities}`, (ev) => {
            console.log(`${WA.WidgetApiToWidgetAction.NotifyCapabilities}`, ev);
        })
        widgetApi.on(`action:${WA.WidgetApiToWidgetAction.SendEvent}`, (ev) => {
            console.log(`${WA.WidgetApiToWidgetAction.SendEvent}`, ev);
        })
        // Start the widget as soon as possible too, otherwise the client might time us out.
        widgetApi.start();

        // Assuming the hosted widget is on the same API path.
        const widgetApiUrl = new URL(`${window.location.origin}${window.location.pathname.replace("/widgetapi/v1/static", "")}`);
        const bridgeApi = await BridgeAPI.getBridgeAPI(widgetApiUrl.toString(), widgetApi);
        const { userId } = await bridgeApi.verify();
        const roomState = widgetKind === "admin" ? await bridgeApi.state() : undefined;
        const supportedServices = await bridgeApi.getEnabledConfigSections();
        await widgetReady;
        this.setState({
            userId,
            roomState,
            roomId,
            supportedServices,
            serviceScope: serviceScope || undefined,
            embedType: embedType === EmbedType.IntegrationManager ? EmbedType.IntegrationManager : EmbedType.Default,
            kind: widgetKind,
            busy: false,
            widgetApi,
            bridgeApi,
        });
    } catch (ex) {
        console.error(`Failed to set up widget:`, ex);
        let error: string = ex.message;
        if (ex instanceof BridgeAPIError) {
            if (ex.errcode === "M_AS_BAD_OPENID") {
                error = "Could not contact your homeserver. Your instance may be misconfigured.";
            }
        }
        this.setState({
            error,
            busy: false,
        });
    }
  }

    render() {
        const style = {
            padding: 'embedType' in this.state && this.state.embedType === EmbedType.IntegrationManager ? "0" : "16px",
        };
        if (this.state.error) {
            return <div style={style}><Alert type="critical" title="An error occured">{this.state.error}</Alert></div>;
        } else if (this.state.busy) {
            return <div style={style}><LoadingSpinner /></div>;
        } else if ("kind" in this.state === false) {
            console.warn("invalid state", this.state);
            return <div style={style}><Alert type="critical" title="An error occured">Widget got into an invalid state.</Alert></div>;
        }

        // Return the App component.
        let content;

        if (this.state.kind === "admin") {
            content = <AdminSettings roomState={this.state.roomState} />;
        }else if (this.state.kind === "roomConfig") {
            content = <RoomConfigView
                roomId={this.state.roomId}
                supportedServices={this.state.supportedServices}
                serviceScope={this.state.serviceScope}
                embedType={this.state.embedType}
                />;
        } else {
            return <div style={style}><Alert type="critical" title="An error occured">Unknown widget kind.</Alert></div>;
        }

        return (
            <div style={style}>
                <BridgeContext.Provider value={{bridgeApi: this.state.bridgeApi}}>
                    {content}
                </BridgeContext.Provider>
            </div>
        );
    }
}
