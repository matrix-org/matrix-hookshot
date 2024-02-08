import {MessageQueueMessagePushJsPush, MessageQueueMessage as MessageQueueMessageRs } from "../libRs"; 


export interface MessageQueueMessagePush<T> extends MessageQueueMessagePushJsPush {
    data: T;
}
export interface MessageQueueMessage<T> extends MessageQueueMessageRs {
    data: T;
}

export interface MessageQueue {
    subscribe: (eventGlob: string) => void;
    unsubscribe: (eventGlob: string) => void;
    push: <T>(data: MessageQueueMessagePush<T>, single?: boolean) => Promise<void>;
    pushWait: <T, X>(data: MessageQueueMessagePush<T>, timeout?: number, single?: boolean) => Promise<X>;
    on: <T>(eventName: string, cb: (data: MessageQueueMessage<T>) => void) => void;
    stop?(): void;
    connect?(): Promise<void>;
}

export const DEFAULT_RES_TIMEOUT = 30000;