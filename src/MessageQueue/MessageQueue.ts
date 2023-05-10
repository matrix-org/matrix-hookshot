import { BridgeConfigQueue } from "../Config/Config";
import { RsLocalMQ } from "../messagequeue/wrapper";
import { RedisMQ } from "./RedisQueue";
import { MessageQueue } from "./Types";

const staticLocalMq = new RsLocalMQ();
let staticRedisMq: RedisMQ|null = null;

export function createMessageQueue(config: BridgeConfigQueue): MessageQueue {
    if (config.monolithic) {
        return staticLocalMq;
    }
    if (staticRedisMq === null) {
        staticRedisMq = new RedisMQ(config);
    }
    return staticRedisMq;
}
