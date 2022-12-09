import { Logger } from "matrix-appservice-bridge";
import { Appservice, IAppserviceRegistration, RustSdkAppserviceCryptoStorageProvider } from "matrix-bot-sdk";
import { BridgeConfig } from "./Config/Config";
import Metrics from "./Metrics";
import { MemoryStorageProvider } from "./Stores/MemoryStorageProvider";
import { RedisStorageProvider } from "./Stores/RedisStorageProvider";
import { IBridgeStorageProvider } from "./Stores/StorageProvider";
const log = new Logger("Appservice");

export function getAppservice(config: BridgeConfig, registration: IAppserviceRegistration) {
    let storage: IBridgeStorageProvider;
    if (config.queue.host && config.queue.port) {
        log.info(`Initialising Redis storage (on ${config.queue.host}:${config.queue.port})`);
        storage = new RedisStorageProvider(config.queue.host, config.queue.port);
    } else {
        log.info('Initialising memory storage');
        storage = new MemoryStorageProvider();
    }

    const cryptoStorage = config.encryption?.storagePath ? new RustSdkAppserviceCryptoStorageProvider(config.encryption.storagePath) : undefined;

    const appservice = new Appservice({
        homeserverName: config.bridge.domain,
        homeserverUrl: config.bridge.url,
        port: config.bridge.port,
        bindAddress: config.bridge.bindAddress,
        registration: {
            ...registration,
            namespaces: {
                // Support multiple users
                users: [{
                    regex: '(' + registration.namespaces.users.map((r) => r.regex).join(')|(') + ')',
                    exclusive: true,
                }],
                aliases: registration.namespaces.aliases,
                rooms: registration.namespaces.rooms,
            }
        },
        storage: storage,
        intentOptions: {
            encryption: !!config.encryption,
        },
        cryptoStorage: cryptoStorage,
    });

    Metrics.registerMatrixSdkMetrics(appservice);

    return {appservice, storage};
}