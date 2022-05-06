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

export default function RoomConfigView(props: IProps) {
    const [ activeConnectionType, setActiveConnectionType ] = useState<null|"generic"|"gitlab">(null);

    let content;

    if (activeConnectionType) {
        content = <>
            {activeConnectionType === "generic" && <GenericWebhookConfig roomId={props.roomId} api={props.bridgeApi} />}
            {activeConnectionType === "gitlab" && <GitlabRepoConfig roomId={props.roomId} api={props.bridgeApi} />}
        </>;
    } else {
        content = <>
            <section>
                <h2> Integrations </h2>
                {props.supportedServices.gitlab && <ConnectionCard
                    imageSrc={GitLabIcon}
                    serviceName="GitLab"
                    description="Connect the room to a GitLab project"
                    onClick={() => setActiveConnectionType("gitlab")}
                />}
                {props.supportedServices.generic && <ConnectionCard
                    imageSrc={WebhookIcon}
                    serviceName="Generic Webhook"
                    description="Create a webhook which can be used to connect any service to Matrix"
                    onClick={() => setActiveConnectionType("generic")}
                />}
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