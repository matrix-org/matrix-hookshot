export * from "./Types";

import { BridgeConfigQueue } from "../Config/Config";
import { MonolithMessageQueue } from "./monolithMessageQueue";
import { RedisMessageQueue } from "./redisMessageQueue";
import { MessageQueue } from "./Types";

const staticLocalMq = new MonolithMessageQueue();
let staticRedisMq: RedisMessageQueue|null = null;

export function createMessageQueue(config: BridgeConfigQueue): MessageQueue {
    if (config.monolithic) {
        return staticLocalMq;
    }
    if (staticRedisMq === null) {
        staticRedisMq = new RedisMessageQueue(config);
    }
    return staticRedisMq;
}
