import { WidgetApi } from "matrix-widget-api";
import { useState } from "preact/hooks"
import { BridgeAPI, BridgeConfig } from "../BridgeAPI";
import style from "./RoomConfigView.module.scss";
import { ConnectionCard } from "./ConnectionCard";
import { FeedsConfig } from "./roomConfig/FeedsConfig";
import { GenericWebhookConfig } from "./roomConfig/GenericWebhookConfig";
import { GithubRepoConfig } from "./roomConfig/GithubRepoConfig";
import { GitlabRepoConfig } from "./roomConfig/GitlabRepoConfig";

import FeedsIcon from "../icons/feeds.png";
import GitHubIcon from "../icons/github.png";
import GitLabIcon from "../icons/gitlab.png";
import WebhookIcon from "../icons/webhook.png";


interface IProps {
    widgetApi: WidgetApi,
    bridgeApi: BridgeAPI,
    supportedServices: {[service: string]: boolean},
    roomId: string,
}

enum ConnectionType {
    Feeds   = "feeds",
    Generic = "generic",
    Github  = "github",
    Gitlab  = "gitlab",
}

interface IConnectionProps {
    displayName: string,
    description: string,
    icon: string,
    component: BridgeConfig,
}

const connections: Record<ConnectionType, IConnectionProps> = {
    [ConnectionType.Feeds]: {
        displayName: "RSS/Atom Feeds",
        description: "Subscribe to an RSS/Atom feed",
        icon: FeedsIcon,
        component: FeedsConfig,
    },
    [ConnectionType.Github]: {
        displayName: 'Github',
        description: "Connect the room to a GitHub project",
        icon: GitHubIcon,
        component: GithubRepoConfig,
    },
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
                {(Object.keys(connections) as Array<ConnectionType>).filter(service => props.supportedServices[service]).map((connectionType: ConnectionType) => {
                    const connection = connections[connectionType];
                    return <ConnectionCard
                        serviceName={connection.displayName}
                        description={connection.description}
                        key={connectionType}
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
