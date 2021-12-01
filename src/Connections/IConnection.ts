import { MatrixEvent, MatrixMessageContent } from "../MatrixEvent";
import { IssuesOpenedEvent, IssuesEditedEvent } from "@octokit/webhooks-types";
import { GetConnectionsResponseItem } from "../provisioning/api";

export interface IConnection {
    roomId: string;

    get connectionId(): string;
    /**
     * When a room gets an update to it's state.
     */
    onStateUpdate?: (ev: MatrixEvent<unknown>) => Promise<void>;
    /**
     * When a room gets any event
     */
    onEvent?: (ev: MatrixEvent<unknown>) => Promise<void>;

    /**
     * When a room gets a message event.
     * @returns Was the message handled
     */
    onMessageEvent?: (ev: MatrixEvent<MatrixMessageContent>) => Promise<boolean>;

    onIssueCreated?: (ev: IssuesOpenedEvent) => Promise<void>;

    onIssueStateChange?: (ev: IssuesEditedEvent) => Promise<void>;

    onIssueEdited?: (event: IssuesEditedEvent) => Promise<void>;

    isInterestedInStateEvent: (eventType: string, stateKey: string) => boolean;

    /**
     * Is the connection interested in the event that is being sent from the remote side?
     */
    isInterestedInHookEvent?: (eventType: string) => boolean;

    /**
     * The details to be sent to the provisioner when requested about this connection.
     */
    getProvisionerDetails?: () => GetConnectionsResponseItem;

    /**
     * If supported, this is sent when a user attempts to update the configuration of a connection.
     */
    provisionerUpdateConfig?: <T extends Record<string, unknown>>(userId: string, config: T) => void;

    /**
     * If supported, this is sent when a user attempts to remove the connection from a room. The connection
     *  state should be removed and any resources should be cleaned away.
     */
    onRemove?: () => void;

    toString(): string;
}