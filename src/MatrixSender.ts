import { BridgeConfig } from "./Config";
import { MessageQueue, createMessageQueue } from "./MessageQueue/MessageQueue";
import { MatrixEventContent } from "./MatrixEvent";
import { Appservice, IAppserviceRegistration } from "matrix-bot-sdk";
import { LogWrapper } from "./LogWrapper";

export interface IMatrixSendMessage {
    sender: string|null;
    type: string;
    roomId: string;
    content: MatrixEventContent;
}

export interface IMatrixSendMessageResponse {
    eventId: string;
}

const log = new LogWrapper("MatrixSender");

export class MatrixSender {
    private mq: MessageQueue;
    private as: Appservice;
    constructor(private config: BridgeConfig, registration: IAppserviceRegistration) {
        this.mq = createMessageQueue(this.config);
        this.as = new Appservice({
            homeserverName: this.config.bridge.domain,
            homeserverUrl: this.config.bridge.url,
            port: 0,
            bindAddress: "",
            registration,
        });
    }

    public listen() {
        this.mq.subscribe("matrix.message");
        this.mq.on<IMatrixSendMessage>("matrix.message", async (msg) => {
            try {
                await this.sendMatrixMessage(msg.messageId!, msg.data);
            } catch (ex) {
                log.error(`Failed to send message (${msg.data.roomId}, ${msg.data.sender}, ${msg.data.type})`);
            }
        });
    }

    public async sendMatrixMessage(messageId: string, msg: IMatrixSendMessage) {
       const intent = msg.sender ? this.as.getIntentForUserId(msg.sender) : this.as.botIntent;
       const eventId = await intent.underlyingClient.sendEvent(msg.roomId, msg.type, msg.content);
       log.info("Sent", eventId);
       this.mq.push<IMatrixSendMessageResponse>({
           eventName: "response.matrix.message",
           sender: "MatrixSender",
           data: {
               eventId,
           },
           messageId,
       });
    }
}
