import { EventEmitter } from "events";
import { MessageQueue, MessageQueueMessage } from "./MessageQueue";
import micromatch from "micromatch";

export class LocalMQ extends EventEmitter implements MessageQueue {
    private subs: Set<string>;
    constructor() {
        super();
        this.subs = new Set();
    }

    public subscribe(eventGlob: string) {
        this.subs.add(eventGlob);
    }

    public unsubscribe(eventGlob: string) {
        this.subs.delete(eventGlob);
    }

    public push(message: MessageQueueMessage) {
        if (!micromatch.match([...this.subs], message.eventName)) {
            return;
        }
        this.emit(message.eventName, message);
    }
}