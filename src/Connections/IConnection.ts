import { MatrixEvent, MatrixMessageContent } from "../MatrixEvent";
import { IGitHubWebhookEvent } from "../GithubWebhooks";

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

    /**
     * When a comment is created on a repo
     */
    onCommentCreated?: (ev: IGitHubWebhookEvent) => Promise<void>;

    onIssueCreated?: (ev: IGitHubWebhookEvent) => Promise<void>;

    onIssueStateChange?: (ev: IGitHubWebhookEvent) => Promise<void>;

    onIssueEdited? :(event: IGitHubWebhookEvent) => Promise<void>;

    isInterestedInStateEvent: (eventType: string, stateKey: string) => boolean;

    toString(): string;
}