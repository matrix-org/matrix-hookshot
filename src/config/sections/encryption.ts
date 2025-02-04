import { ConfigError } from "../../errors";
import { configKey } from "../Decorators";

interface BridgeConfigEncryptionYAML {
    storagePath: string;
}

export class BridgeConfigEncryption {
    @configKey("Path to the directory used to store encryption files. These files must be persist between restarts of the service.")
    public readonly storagePath: string;

    constructor(config: BridgeConfigEncryptionYAML, cache: unknown|undefined, queue: unknown|undefined) {
        if (typeof config.storagePath !== "string" || !config.storagePath) {
            throw new ConfigError("encryption.storagePath", "The crypto storage path must not be empty.");
        }
        this.storagePath = config.storagePath;

        if (!cache) {
            throw new ConfigError("cache", "Encryption requires the Redis cache to be enabled.");
        }
        if (queue) {
            throw new ConfigError("queue", "Encryption does not support message queues.");
        }
    }
}
