import { Appservice, IAppserviceRegistration, IAppserviceStorageProvider } from "matrix-bot-sdk";
import { BridgeConfig } from "./Config/Config";

export function getAppservice(config: BridgeConfig, registration: IAppserviceRegistration, storage: IAppserviceStorageProvider) {
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
    });
}