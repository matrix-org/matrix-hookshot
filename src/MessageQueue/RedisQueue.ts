import { MessageQueue, MessageQueueMessage } from "./MessageQueue";
import { Redis, default as redis } from "ioredis";
import { BridgeConfig } from "../Config";
import { EventEmitter } from "events";

export class RedisMQ extends EventEmitter implements MessageQueue {
    private redis: Redis;
    constructor(config: BridgeConfig) {
        super();
        this.redis = new redis(config.queue.port, config.queue.host);
        this.redis.on("pmessage", (_pattern: string, channel: string, message: string) => {
            const msg = JSON.parse(message);
            const delay = (process.hrtime()[1]) - msg.ts!;
            console.log("Delay: ", delay / 1000000, "ms");
            this.emit(channel, JSON.parse(message));
        });
    }

    public subscribe (eventGlob: string) {
        this.redis.psubscribe(eventGlob);
    }

    public unsubscribe (eventGlob: string) {
        this.redis.punsubscribe(eventGlob);
    }

    public push (data: MessageQueueMessage) {
        data.ts = process.hrtime()[1];
        this.redis.publish(data.eventName, JSON.stringify(data));
    }
}