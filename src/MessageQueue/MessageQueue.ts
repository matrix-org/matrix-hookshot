import { BridgeConfig } from "../Config";
import { LocalMQ } from "./LocalMQ";
import { RedisMQ } from "./RedisQueue";

const staticLocalMq = new LocalMQ();
let staticRedisMq: RedisMQ|null = null;

export interface MessageQueueMessage {
    sender: string;
    eventName: string;
    // tslint:disable-next-line: no-any
    data: any;
    ts?: number;
}

export interface MessageQueue {
    subscribe: (eventGlob: string) => void;
    unsubscribe: (eventGlob: string) => void;
    push: (data: MessageQueueMessage) => void;
    on: (eventName: string, cb: (data: MessageQueueMessage) => void) => void;
}

export function createMessageQueue(config: BridgeConfig): MessageQueue {
    if (config.queue.monolithic) {
        return staticLocalMq;
    }
    if (staticRedisMq === null) {
        staticRedisMq = new RedisMQ(config);
    }
    return staticRedisMq;
}
