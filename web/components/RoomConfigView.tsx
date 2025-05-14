import { lazy, Suspense } from "preact/compat"
import { useState } from "preact/hooks"
import { BridgeConfig, EmbedType } from "../BridgeAPI";
import style from "./RoomConfigView.module.scss";
import { ConnectionCard } from "./ConnectionCard";
import FeedsIcon from "../icons/feeds.png";
import GitHubIcon from "../icons/github.png";
import GitLabIcon from "../icons/gitlab.png";
import JiraIcon from "../icons/jira.png";
import WebhookIcon from "../icons/webhook.png";
import { ChevronLeftIcon } from "@vector-im/compound-design-tokens/assets/web/icons";


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
        component: lazy(() => import("./roomConfig/FeedsConfig")),
    },
    [ConnectionType.Github]: {
        displayName: 'Github',
        description: "Connect the room to a GitHub project",
        icon: GitHubIcon,
        darkIcon: true,
        component: lazy(() => import("./roomConfig/GithubRepoConfig")),
    },
    [ConnectionType.Gitlab]: {
        displayName: 'Gitlab',
        description: "Connect the room to a GitLab project",
        icon: GitLabIcon,
        component: lazy(() => import("./roomConfig/GitlabRepoConfig")),
    },
    [ConnectionType.Jira]: {
        displayName: 'JIRA',
        description: "Connect the room to a JIRA project",
        icon: JiraIcon,
        component: lazy(() => import("./roomConfig/JiraProjectConfig")),
    },
    [ConnectionType.Generic]: {
        displayName: 'Inbound (Generic) Webhook',
        description: "Create a webhook which can be used to connect any service to Matrix",
        icon: WebhookIcon,
        darkIcon: true,
        component: lazy(() => import("./roomConfig/GenericWebhookConfig")),
    },
    [ConnectionType.GenericOutbound]: {
        displayName: 'Outbound Webhook',
        description: "Create a webhook which can be used to connect any service to Matrix",
        icon: WebhookIcon,
        darkIcon: true,
        component: lazy(() => import("./roomConfig/OutboundWebhookConfig")),
    },
};

export default function RoomConfigView(props: IProps) {
    const serviceScope = props.serviceScope && props.supportedServices[props.serviceScope] ? props.serviceScope as ConnectionType : null;
    const [ activeConnectionType, setActiveConnectionType ] = useState<ConnectionType|null>(serviceScope);

    let content;

    if (activeConnectionType) {
        const ConfigComponent = connections[activeConnectionType].component;
        content = <Suspense fallback="loading">
            <ConfigComponent roomId={props.roomId} showHeader={props.embedType !== EmbedType.IntegrationManager} />
        </Suspense>;
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
                    <ChevronLeftIcon /> Browse integrations
                </span>
            </header>
        }
        {content}
    </div>;
}
