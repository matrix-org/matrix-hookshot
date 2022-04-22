import { FormatUtil } from "../FormatUtil";
import { IConnectionState } from ".";
import { MatrixClient } from "matrix-bot-sdk";
import { MatrixEvent } from "../MatrixEvent";

/**
 * Base connection class from which all connections should extend from.
 */
export abstract class BaseConnection {
    constructor(
        public readonly roomId: string,
        public readonly stateKey: string,
        public readonly canonicalStateType: string) {

    }

    public get connectionId(): string {
        return FormatUtil.hashId(`${this.roomId}/${this.canonicalStateType}/${this.stateKey}`);
    }

    public get priority(): number {
        return -1;
    }
}

export interface ChattyConnectionState extends IConnectionState {
    msgtype?: string;
}

export abstract class ChattyConnection extends BaseConnection {
    private msgtype: string|undefined;
    constructor(
        roomId: string,
        stateKey: string,
        canonicalStateType: string,
        chattyState: ChattyConnectionState,
        private client: MatrixClient,
    ) {
        super(roomId, stateKey, canonicalStateType);
        this.msgtype = chattyState.msgtype;
    }

    public async onStateUpdate(event: MatrixEvent<unknown>): Promise<void> {
        if (event.content && typeof event.content === 'object') {
            this.msgtype = (event.content as any).msgtype;
        }
    }

    public async sendMessage(content: any): Promise<string> {
        return this.client.sendEvent(this.roomId, 'm.room.message', {
            msgtype: this.msgtype || 'm.notice',
            ...content
        });
    }
}
