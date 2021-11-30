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

export const DEFAULT_RES_TIMEOUT = 30000;