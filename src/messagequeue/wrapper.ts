import { DEFAULT_RES_TIMEOUT, MessageQueue, MessageQueueMessage, MessageQueueMessagePush } from "../MessageQueue";
import { LocalMQ, MessageQueueMessagePushJsPush } from "../libRs";

export class RsLocalMQ implements MessageQueue {
    public mq = new LocalMQ();

    public subscribe(eventGlob: string) {this.mq.subscribe(eventGlob)}
    public unsubscribe(eventGlob: string) {this.mq.unsubscribe(eventGlob)}

    public async push(data: MessageQueueMessagePushJsPush, single?: boolean) {
        this.mq.push(data);
    }

    public on<T>(eventName: string, cb: (data: MessageQueueMessage<T>) => void): Promise<void> {
        this.mq.on(eventName, (err, message) => {
            if (err) {
                // TODO: Handle this better
                throw Error(err);
            }
            cb(message)
        });
        return Promise.resolve();
    }

    public once<T>(eventName: string, cb: (data: MessageQueueMessage<T>) => void): void {
        this.mq.on(eventName, (err, message) => {
            if (err) {
                // TODO: Handle this better
                throw Error(err);
            }
            cb(message)
        })
    }
   
    // pushWait isn't really used in rust code yet, and is fiendishly difficult to write in Rust, so this wraps the JS side
    public async pushWait<T, X>(message: MessageQueueMessagePush<T>,
                                timeout: number = DEFAULT_RES_TIMEOUT): Promise<X> {
        let resolve: (value: X) => void;
        let timer: NodeJS.Timer;

        const p = new Promise<X>((res, rej) => {
            resolve = res;
            timer = setTimeout(() => {
                rej(new Error(`Timeout waiting for message queue response for ${message.eventName} / ${message.id}`));
            }, timeout);
        });

        const awaitResponse = (response: MessageQueueMessage<X>) => {
            if (response.id === message.id) {
                clearTimeout(timer);
                resolve(response.data);
            }
        };
        this.once(`response.${message.id}`, awaitResponse);
        this.push(message);
        return p;
    }

}