import { BridgeConfig } from "../Config";
import { LocalMQ } from "./LocalMQ";
import { RedisMQ } from "./RedisQueue";

export const DEFAULT_RES_TIMEOUT = 30000;

const staticLocalMq = new LocalMQ();
let staticRedisMq: RedisMQ|null = null;

export interface MessageQueueMessage<T> {
    sender: string;
    eventName: string;
    data: T;
    ts?: number;
    messageId?: string;
}

export interface MessageQueue {
    subscribe: (eventGlob: string) => void;
    unsubscribe: (eventGlob: string) => void;
    push: <T>(data: MessageQueueMessage<T>) => void;
    pushWait: <T, X>(data: MessageQueueMessage<T>) => Promise<X>;
    on: <T>(eventName: string, cb: (data: MessageQueueMessage<T>) => void) => void;
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
