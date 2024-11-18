import { BridgeConfig } from "./config/Config";
import { MessageQueue, createMessageQueue } from "./MessageQueue";
import { Appservice } from "matrix-bot-sdk";
import { Logger } from "matrix-appservice-bridge";
import { randomUUID } from 'node:crypto';

export interface IMatrixSendMessage {
    sender: string|null;
    type: string;
    roomId: string;
    content: Record<string, unknown>;
}

export interface IMatrixSendMessageResponse {
    eventId: string;
}

export interface IMatrixSendMessageFailedResponse {
    failed: boolean;
}


const log = new Logger("MatrixSender");

export class MatrixSender {
    private mq: MessageQueue;
    constructor(private config: BridgeConfig, private readonly as: Appservice) {
        this.mq = createMessageQueue(this.config.queue);
    }

    public listen() {
        this.mq.subscribe("matrix.message");
        this.mq.on<IMatrixSendMessage>("matrix.message", async (msg) => {
            try {
                await this.sendMatrixMessage(msg.messageId || randomUUID(), msg.data);
            } catch (ex) {
                log.error(`Failed to send message (${msg.data.roomId}, ${msg.data.sender}, ${msg.data.type})`, ex);
            }
        });
    }

    public stop() {
        if (this.mq.stop) {
            this.mq.stop();
        }
    }

    public async sendMatrixMessage(messageId: string, msg: IMatrixSendMessage) {
        const intent = msg.sender ? this.as.getIntentForUserId(msg.sender) : this.as.botIntent;
        if (this.config.encryption) {
            // Ensure crypto is aware of all members of this room before posting any messages,
            // so that the bot can share room keys to all recipients first.
            await intent.enableEncryption();
            await intent.joinRoom(msg.roomId);
            await intent.underlyingClient.crypto.onRoomJoin(msg.roomId);
        } else {
            await intent.ensureRegisteredAndJoined(msg.roomId);
        }
        try {
                const eventId = await intent.underlyingClient.sendEvent(msg.roomId, msg.type, msg.content);
                log.info(`Sent event to room ${msg.roomId} (${msg.sender}) > ${eventId}`);
                await this.mq.push<IMatrixSendMessageResponse>({
                    eventName: "response.matrix.message",
                    sender: "MatrixSender",
                    data: {
                        eventId,
                    },
                    messageId,
                });
        } catch (ex) {
            await this.mq.push<IMatrixSendMessageFailedResponse>({
                eventName: "response.matrix.message",
                sender: "MatrixSender",
                data: {
                    failed: true,
                },
                messageId,
            });
        }
    }
}

export class MessageSenderClient {
    constructor(private queue: MessageQueue) { }

    public async sendMatrixText(roomId: string, text: string, msgtype = "m.text",
                                sender: string|null = null): Promise<string> {
        return this.sendMatrixMessage(roomId, {
            msgtype,
            body: text,
        }, "m.room.message", sender);
    }

    public async sendMatrixMessage(roomId: string,
                                   content: unknown, eventType = "m.room.message",
                                   sender: string|null = null): Promise<string> {
        const result = await this.queue.pushWait<IMatrixSendMessage, IMatrixSendMessageResponse|IMatrixSendMessageFailedResponse>({
            eventName: "matrix.message",
            sender: "Bridge",
            data: {
                roomId,
                type: eventType,
                sender,
                content: content as Record<string, undefined>,
            },
        });

        if ("eventId" in result) {
            return result.eventId;
        }
        throw Error('Failed to send Matrix message');
    }
}
