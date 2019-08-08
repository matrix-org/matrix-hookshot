import { MessageQueue, MessageQueueMessage, DEFAULT_RES_TIMEOUT } from "./MessageQueue";
import { Redis, default as redis } from "ioredis";
import { BridgeConfig } from "../Config";
import { EventEmitter } from "events";
import { LogWrapper } from "../LogWrapper";
import uuid from "uuid/v4";

const log = new LogWrapper("RedisMq");

export class RedisMQ extends EventEmitter implements MessageQueue {
    private redisSub: Redis;
    private redisPub: Redis;
    constructor(config: BridgeConfig) {
        super();
        this.redisSub = new redis(config.queue.port, config.queue.host);
        this.redisPub = new redis(config.queue.port, config.queue.host);
        this.redisSub.on("pmessage", (pattern: string, channel: string, message: string) => {
            const msg = JSON.parse(message);
            const delay = (process.hrtime()[1]) - msg.ts!;
            log.debug("Delay: ", delay / 1000000, "ms");
            this.emit(channel, JSON.parse(message));
        });
    }

    public subscribe(eventGlob: string) {
        this.redisSub.psubscribe(eventGlob);
    }

    public unsubscribe(eventGlob: string) {
        this.redisSub.punsubscribe(eventGlob);
    }

    public push<T>(message: MessageQueueMessage<T>) {
        if (!message.messageId) {
            message.messageId = uuid();
        }
        message.ts = process.hrtime()[1];
        this.redisPub.publish(message.eventName, JSON.stringify(message)).then(() => {
            log.debug(`Pushed ${message.eventName}`);
        }).catch((ex) => {
            log.warn("Failed to push an event:", ex);
        });
    }

    public async pushWait<T, X>(message: MessageQueueMessage<T>,
                                timeout: number = DEFAULT_RES_TIMEOUT): Promise<X> {
        let awaitResponse: (response: MessageQueueMessage<X>) => void;
        let resolve: (value: X) => void;
        let timer: NodeJS.Timer;

        const p = new Promise<X>((res, rej) => {
            resolve = res;
            timer = setTimeout(() => {
                rej(new Error("Timeout waiting for message queue response"));
                }, timeout);
        });

        awaitResponse = (response: MessageQueueMessage<X>) => {
            if (response.messageId === message.messageId) {
                clearTimeout(timer);
                this.removeListener(`response.${message.eventName}`, awaitResponse);
                resolve(response.data);
            }
        };

        this.addListener(`response.${message.eventName}`, awaitResponse);
        this.push(message);
        return p;
    }
}
