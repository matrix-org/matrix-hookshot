import { BridgeConfig } from "../Config/Config";
import { LocalMQ } from "./LocalMQ";
import { RedisMQ } from "./RedisQueue";

export const DEFAULT_RES_TIMEOUT = 30000;

const staticLocalMq = new LocalMQ();
let staticRedisMq: RedisMQ|null = null;


export interface MessageQueueMessage<T> {
    sender: string;
    eventName: string;
    data: T;
    messageId?: string;
    for?: string;
}

export interface MessageQueueMessageOut<T> extends MessageQueueMessage<T> {
    ts: number;
}

export interface MessageQueue {
    subscribe: (eventGlob: string) => void;
    unsubscribe: (eventGlob: string) => void;
    push: <T>(data: MessageQueueMessage<T>, single?: boolean) => Promise<void>;
    pushWait: <T, X>(data: MessageQueueMessage<T>, timeout?: number, single?: boolean) => Promise<X>;
    on: <T>(eventName: string, cb: (data: MessageQueueMessageOut<T>) => void) => void;
    stop?(): void;
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
