import { WidgetApi } from "matrix-widget-api";
import { h, Fragment } from "preact";
import { useState } from "preact/hooks"
import BridgeAPI from "../BridgeAPI";
import style from "./RoomConfigView.module.scss";
import { ConnectionCard } from "./ConnectionCard";
import { GenericWebhookConfig } from "./roomConfig/GenericWebhookConfig";
import { GitlabRepoConfig } from "./roomConfig/GitlabRepoConfig";

import GitLabIcon from "../icons/gitlab.png";
import WebhookIcon from "../icons/webhook.png";


interface IProps {
    widgetApi: WidgetApi,
    bridgeApi: BridgeAPI,
    supportedServices: {[service: string]: boolean},
    roomId: string,
}

enum ConnectionType {
    Generic = "generic",
    Gitlab  = "gitlab",
}

const connections = {
    [ConnectionType.Gitlab]: {
        displayName: 'Gitlab',
        description: "Connect the room to a GitLab project",
        icon: GitLabIcon,
        component: GitlabRepoConfig,
    },
    [ConnectionType.Generic]: {
        displayName: 'Generic Webhook',
        description: "Create a webhook which can be used to connect any service to Matrix",
        icon: WebhookIcon,
        component: GenericWebhookConfig,
    },
};

export default function RoomConfigView(props: IProps) {
    const [ activeConnectionType, setActiveConnectionType ] = useState<ConnectionType|null>(null);

    let content;

    if (activeConnectionType) {
        const ConfigComponent = connections[activeConnectionType].component;
        content = <ConfigComponent roomId={props.roomId} api={props.bridgeApi} />;
    } else {
        content = <>
            <section>
                <h2> Integrations </h2>
                {Object.keys(connections).filter(service => props.supportedServices[service]).map((connectionType: ConnectionType) => {
                    const connection = connections[connectionType];
                    return <ConnectionCard
                        serviceName={connection.displayName}
                        description={connection.description}
                        imageSrc={connection.icon}
                        onClick={() => setActiveConnectionType(connectionType)}
                    />
                })}
            </section>
        </>;
    }

    return <div className={style.root}>
        <header>
            {activeConnectionType && <span className={style.backButton} onClick={() => setActiveConnectionType(null)}><span className="chevron" /> Browse integrations</span>}
        </header>
        {content}
    </div>;
}