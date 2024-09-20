import { useState } from "preact/hooks"
import { BridgeConfig, EmbedType } from "../BridgeAPI";
import style from "./RoomConfigView.module.scss";
import { ConnectionCard } from "./ConnectionCard";
import { FeedsConfig } from "./roomConfig/FeedsConfig";
import { GenericWebhookConfig } from "./roomConfig/GenericWebhookConfig";
import { OutboundWebhookConfig } from "./roomConfig/OutboundWebhookConfig";
import { GithubRepoConfig } from "./roomConfig/GithubRepoConfig";
import { GitlabRepoConfig } from "./roomConfig/GitlabRepoConfig";
import { JiraProjectConfig } from "./roomConfig/JiraProjectConfig";

import FeedsIcon from "../icons/feeds.png";
import GitHubIcon from "../icons/github.png";
import GitLabIcon from "../icons/gitlab.png";
import JiraIcon from "../icons/jira.png";
import WebhookIcon from "../icons/webhook.png";


interface IProps {
    supportedServices: {[service: string]: boolean},
    serviceScope?: string,
    embedType: EmbedType,
    roomId: string,
}

enum ConnectionType {
    Feeds   = "feeds",
    Generic = "generic",
    GenericOutbound = "genericOutbound",
    Github  = "github",
    Gitlab  = "gitlab",
    Jira    = "jira",
}

interface IConnectionProps {
    displayName: string,
    description: string,
    icon: string,
    darkIcon?: true,
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
        darkIcon: true,
        component: GithubRepoConfig,
    },
    [ConnectionType.Gitlab]: {
        displayName: 'Gitlab',
        description: "Connect the room to a GitLab project",
        icon: GitLabIcon,
        component: GitlabRepoConfig,
    },
    [ConnectionType.Jira]: {
        displayName: 'JIRA',
        description: "Connect the room to a JIRA project",
        icon: JiraIcon,
        component: JiraProjectConfig,
    },
    [ConnectionType.Generic]: {
        displayName: 'Inbound (Generic) Webhook',
        description: "Create a webhook which can be used to connect any service to Matrix",
        icon: WebhookIcon,
        darkIcon: true,
        component: GenericWebhookConfig,
    },
    [ConnectionType.GenericOutbound]: {
        displayName: 'Outbound Webhook',
        description: "Create a webhook which can be used to connect any service to Matrix",
        icon: WebhookIcon,
        darkIcon: true,
        component: OutboundWebhookConfig,
    },
};

export default function RoomConfigView(props: IProps) {
    const serviceScope = props.serviceScope && props.supportedServices[props.serviceScope] ? props.serviceScope as ConnectionType : null;
    const [ activeConnectionType, setActiveConnectionType ] = useState<ConnectionType|null>(serviceScope);

    let content;

    if (activeConnectionType) {
        const ConfigComponent = connections[activeConnectionType].component;
        content = <ConfigComponent
            roomId={props.roomId}
            showHeader={props.embedType !== EmbedType.IntegrationManager}
        />;
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
                        darkImage={connection.darkIcon}
                        onClick={() => setActiveConnectionType(connectionType)}
                    />
                })}
            </section>
        </>;
    }

    return <div className={style.root}>

        {!serviceScope && activeConnectionType &&
            <header>
                <span className={style.backButton} onClick={() => setActiveConnectionType(null)}>
                    <span className="chevron" /> Browse integrations
                </span>
            </header>
        }
        {content}
    </div>;
}
