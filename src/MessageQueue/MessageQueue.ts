import { BridgeConfigQueue } from "../config/sections/index";
import { LocalMQ } from "./LocalMQ";
import { RedisMQ } from "./RedisQueue";
import { MessageQueue } from "./Types";

const staticLocalMq = new LocalMQ();
let staticRedisMq: RedisMQ|null = null;

export function createMessageQueue(config?: BridgeConfigQueue): MessageQueue {
    if (!config) {
        return staticLocalMq;
    }
    if (staticRedisMq === null) {
        staticRedisMq = new RedisMQ(config);
    }
    return staticRedisMq;
}
