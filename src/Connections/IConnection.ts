import { MatrixEvent, MatrixMessageContent } from "../MatrixEvent";
import { IssuesOpenedEvent, IssuesEditedEvent } from "@octokit/webhooks-types";

export interface IConnection {
    roomId: string;
    /**
     * When a room gets an update to it's state.
     */
    onStateUpdate?: (ev: MatrixEvent<unknown>) => Promise<void>;
    /**
     * When a room gets any event
     */
    onEvent?: (ev: MatrixEvent<unknown>) => Promise<void>;

    /**
     * When a room gets a message event
     */
    onMessageEvent?: (ev: MatrixEvent<MatrixMessageContent>) => Promise<void>;

    onIssueCreated?: (ev: IssuesOpenedEvent) => Promise<void>;

    onIssueStateChange?: (ev: IssuesEditedEvent) => Promise<void>;

    onIssueEdited? :(event: IssuesEditedEvent) => Promise<void>;

    isInterestedInStateEvent: (eventType: string, stateKey: string) => boolean;

    /**
     * Is the connection interested in the event that is being sent from the remote side?
     */
    isInterestedInHookEvent?: (eventType: string) => boolean;

    toString(): string;
}