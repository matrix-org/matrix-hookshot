import { MatrixEvent, MatrixMessageContent } from "../MatrixEvent";
import { IWebhookEvent } from "../GithubWebhooks";

export interface IConnection {
    roomId: string;
    /**
     * When a room gets an update to it's state.
     */
    onStateUpdate: (ev: any) => Promise<void>;
    /**
     * When a room gets any event
     */
    onEvent: (ev: MatrixEvent<unknown>) => Promise<void>;

    /**
     * When a room gets a message event
     */
    onMessageEvent?: (ev: MatrixEvent<MatrixMessageContent>) => Promise<void>;

    /**
     * When a comment is created on a repo
     */
    onCommentCreated?: (ev: IWebhookEvent) => Promise<void>;

    onIssueStateChange?: (ev: IWebhookEvent) => Promise<void>;

    onIssueEdited? :(event: IWebhookEvent) => Promise<void>;

    isInterestedInStateEvent: (eventType: string, stateKey: string) => boolean;

    toString(): string;
}