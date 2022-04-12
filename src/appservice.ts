import { Appservice, IAppserviceRegistration, IAppserviceStorageProvider, RustSdkAppserviceCryptoStorageProvider } from "matrix-bot-sdk";
import { BridgeConfig } from "./Config/Config";

export function getAppservice(config: BridgeConfig, registration: IAppserviceRegistration, storage: IAppserviceStorageProvider) {
    const cryptoStorage = config.encryption?.storagePath ? new RustSdkAppserviceCryptoStorageProvider(config.encryption.storagePath) : undefined;

    return new Appservice({
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
}