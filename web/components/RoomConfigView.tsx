import { WidgetApi } from "matrix-widget-api";
import { h, FunctionComponent, Fragment } from "preact";
import { useCallback, useState } from "preact/hooks"
import BridgeAPI from "../BridgeAPI";
import { GetConnectionsResponseItem } from "../../src/provisioning/api";
import ErrorPane from "./ErrorPane";
import style from "./RoomConfigView.module.scss";
import { ServiceCard } from "./ServiceCard";
import { GenericWebhookConfig } from "./connectionConfig/GenericWebhookConfig";


interface IProps {
    widgetApi: WidgetApi,
    bridgeApi: BridgeAPI,
    supportedServices: {[service: string]: boolean},
    roomId: string,
}

export default function RoomConfigView(props: IProps) {
    const [ error, setError ] = useState<null|string>(null);
    const [ connections, setConnections ] = useState<null|GetConnectionsResponseItem[]>(null);
    const [ configureConnection, setConfigureConnection ] = useState<null|GetConnectionsResponseItem>(null);

    if (connections === null) {
        props.bridgeApi.getConnectionsForRoom(props.roomId)
        .then(res => setConnections(res))
        .catch(ex => {
            console.warn("Failed to fetch existing connections", ex);
            setError("Failed to fetch existing connections");
        });
    }

    let content;

    if (configureConnection) {
        content = <>
            {configureConnection.service === "generic" && <GenericWebhookConfig connection={configureConnection}></GenericWebhookConfig>}
        </>;
    } else {
        content = <>
            <section>
                <h2> Connections</h2>
                {connections === null && <div class="spinner"/> }
                {connections?.length === 0 && <p> This room is not currently connected to any services. </p>}
                {connections?.length > 0 && <p> This room is connected to the following services. </p>}
                {connections?.map(c => <ServiceCard onConfigure={() => setConfigureConnection(c)} iconUrl="icons/webhook.webp" key={c.id} serviceName={`${c.type} (${c.config.name})`}></ServiceCard>)}
            </section>
            <section>
                <h2> Setup New Connection </h2>
                {props.supportedServices["generic"] && <button>Setup Webhook Connection</button>}
            </section>
        </>;
    }

    return <div className={style.root}>
        {
            error && <ErrorPane header="Error">{error}</ErrorPane>
        }
        <header>
            <h1> Hookshot Configuration </h1>
            {configureConnection && <h2>{`${configureConnection.type} (${configureConnection.config.name})`}</h2>}
            {configureConnection && <button onClick={() => setConfigureConnection(null)}>Back</button>}
        </header>
        {content}
    </div>;
}