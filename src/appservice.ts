import { Server } from "http";
import { Appservice, IAppserviceRegistration, IAppserviceStorageProvider } from "matrix-bot-sdk";
import { BridgeConfig } from "./Config/Config";

export function getAppservice(config: BridgeConfig, registration: IAppserviceRegistration, storage: IAppserviceStorageProvider) {
    const as = new Appservice({
        homeserverName: config.bridge.domain,
        homeserverUrl: config.bridge.url,
        // These are unused, but required. If the application attempts to actually use them
        // the obvious invalid values should throw.
        port: -9001,
        bindAddress: "-9000",
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

    // We want to prevent express from actually starting a listener,
    // but instead server a dummy Server so that the bot-sdk doesn't
    // know any better.
    // Actual listener handling is done through the `ListenerService` logic.
    as.expressAppInstance.listen = (...args: unknown[]) => {
        (args.find(arg => typeof arg === 'function') as () => void)?.();
        return {
            close: () => { /* dummy method */},
        } as unknown as Server };
    return as;
}