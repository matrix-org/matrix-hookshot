import { BridgeConfig } from "./Config/Config";
import { MessageQueue, createMessageQueue } from "./MessageQueue";
import { MatrixEventContent, MatrixMessageContent } from "./MatrixEvent";
import { Appservice, IAppserviceRegistration, MemoryStorageProvider } from "matrix-bot-sdk";
import LogWrapper from "./LogWrapper";
import { v4 as uuid } from "uuid";
import { getAppservice } from "./appservice";
import Metrics from "./Metrics";

export interface IMatrixSendMessage {
    sender: string|null;
    type: string;
    roomId: string;
    content: MatrixEventContent;
}

export interface IMatrixSendMessageResponse {
    eventId: string;
}

export interface IMatrixSendMessageFailedResponse {
    failed: boolean;
}


const log = new LogWrapper("MatrixSender");

export class MatrixSender {
    private mq: MessageQueue;
    private as: Appservice;
    constructor(private config: BridgeConfig, registration: IAppserviceRegistration) {
        this.mq = createMessageQueue(this.config);
        this.as = getAppservice(config, registration, new MemoryStorageProvider());
        Metrics.registerMatrixSdkMetrics(this.as);
    }

    public listen() {
        this.mq.subscribe("matrix.message");
        this.mq.on<IMatrixSendMessage>("matrix.message", async (msg) => {
            try {
                await this.sendMatrixMessage(msg.messageId || uuid(), msg.data);
            } catch (ex) {
                log.error(`Failed to send message (${msg.data.roomId}, ${msg.data.sender}, ${msg.data.type})`);
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
        await intent.ensureRegisteredAndJoined(msg.roomId);
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
        } as MatrixMessageContent, "m.room.message", sender);
    }

    public async sendMatrixMessage(roomId: string,
                                   content: MatrixEventContent, eventType = "m.room.message",
                                   sender: string|null = null): Promise<string> {
        const result = await this.queue.pushWait<IMatrixSendMessage, IMatrixSendMessageResponse|IMatrixSendMessageFailedResponse>({
            eventName: "matrix.message",
            sender: "Bridge",
            data: {
                roomId,
                type: eventType,
                sender,
                content,
            },
        });

        if ("eventId" in result) {
            return result.eventId;
        }
        throw Error('Failed to send Matrix message');
    }
}
