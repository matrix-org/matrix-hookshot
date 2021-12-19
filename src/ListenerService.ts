import { Server } from "http";
import { Application, default as expressApp, Router } from "express";
import LogWrapper from "./LogWrapper";

// Appserices can't be handled yet because the bot-sdk maintains control of it.
export type ResourceName = "webhooks"|"widgets"|"metrics"|"provisioning";

export interface BridgeConfigListener {
    bindAddress?: string;
    port: number;
    resources: Array<ResourceName>;
}

const log = new LogWrapper("ListenerService");

export class ListenerService {
    private readonly listeners: {
        server?: Server,
        app: Application,
        config: BridgeConfigListener,
        resourcesBound: boolean,
    }[] = [];

    constructor(config: BridgeConfigListener[]) {
        if (config.length < 1) {
            throw Error('No listeners configured');
        }
        for (const listenerConfig of config) {
            const app = expressApp();
            this.listeners.push({
                config: listenerConfig,
                app,
                resourcesBound: false,
            });
        }
    }

    public bindResource(resourceName: ResourceName, router: Router) {
        for (const listener of this.listeners.filter((l) => l.config.resources.includes(resourceName))) {
            log.info(`Registering ${listener.config.bindAddress || "127.0.0.1"}:${listener.config.port} for ${resourceName}`);
            listener.app.use(router);
            listener.resourcesBound = true;
        }
    }

    public start() {
        for (const listener of this.listeners) {
            if (listener.server) {
                throw Error('Cannot run start() twice');
            }
            if (!listener.resourcesBound) {
                continue;
            }
            const addr = listener.config.bindAddress || "127.0.0.1";
            listener.server = listener.app.listen(listener.config.port, addr);
            log.info(`Listening on ${addr}:${listener.config.port} for ${listener.config.resources.join(', ')}`)
        }
    }

    public async stop() {
        const promises = [];
        log.info(`Stopping all listeners`);
        for (const listener of this.listeners) {
            if (listener.server) {
                promises.push(new Promise<void>((res, rej) => listener.server?.close((e) => e ? rej(e) : res())));
            }
        }
        await Promise.all(promises);
    }
}
