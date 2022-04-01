import { WidgetApi } from "matrix-widget-api";
import { h, Fragment } from "preact";
import { useState } from "preact/hooks"
import BridgeAPI from "../BridgeAPI";
import style from "./RoomConfigView.module.scss";
import { ConnectionCard } from "./ConnectionCard";
import { GenericWebhookConfig } from "./connectionConfig/GenericWebhookConfig";


interface IProps {
    widgetApi: WidgetApi,
    bridgeApi: BridgeAPI,
    supportedServices: {[service: string]: boolean},
    roomId: string,
}

export default function RoomConfigView(props: IProps) {
    const [ activeConnectionType, setActiveConnectionType ] = useState<null|"generic">(null);

    let content;

    if (activeConnectionType) {
        content = <>
            {activeConnectionType === "generic" && <GenericWebhookConfig roomId={props.roomId} api={props.bridgeApi}/>}
        </>;
    } else {
        content = <>
            <section>
                <h2> Integrations </h2>
                {props.supportedServices["generic"] && <ConnectionCard
                    imageSrc="./icons/webhook.webp"
                    serviceName="Generic Webhook"
                    description="Create a webhook which can be used to connect any service to Matrix"
                    onClick={() => setActiveConnectionType("generic")}
                >Setup Webhook Connection</ConnectionCard>}
            </section>
        </>;
    }

    return <div className={style.root}>
        <header>
            {activeConnectionType && <span className={style.backButton} onClick={() => setActiveConnectionType(null)}><span className="chevron"/> Browse integrations</span>}
            {/* {configureConnection && <h2>{`${configureConnection.type} (${configureConnection.config.name})`}</h2>}
            {configureConnection && <button onClick={() => setConfigureConnection(null)}>Back</button>} */}
        </header>
        {content}
    </div>;
}