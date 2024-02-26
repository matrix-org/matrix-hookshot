/**
 * Configuration for the message queue.
 */
interface BridgeConfigQueueBase {
    /**
     * Controls whether the queue config is used just for the cache (monolithic),
     * or the message queue as well.
     * @deprecated Use the `cache` config instead to control this seperately.
     */
    monolithic?: boolean;
}

interface BridgeConfigQueueUri extends BridgeConfigQueueBase {
   redisUri: string;
}

interface BridgeConfigQueueLegacyOptions extends BridgeConfigQueueBase {
    port?: number;
    host?: string;
}

export type BridgeConfigQueue = BridgeConfigQueueUri|BridgeConfigQueueLegacyOptions