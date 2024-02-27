import { Server } from "http";
import { Logger } from "matrix-appservice-bridge";
import { Application, default as expressApp, NextFunction, Request, Response, Router } from "express";
import { errorMiddleware } from "./api";

// Appserices can't be handled yet because the bot-sdk maintains control of it.
// See https://github.com/turt2live/matrix-bot-sdk/issues/191
export type ResourceName = "webhooks"|"widgets"|"metrics"|"provisioning";
export const ResourceTypeArray: ResourceName[] = ["webhooks","widgets","metrics","provisioning"];
import { Handlers } from "@sentry/node";
export interface BridgeConfigListener {
    bindAddress?: string;
    port: number;
    resources: Array<ResourceName>;
}

const log = new Logger("ListenerService");

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
            app.set('x-powered-by', false);
            app.use(Handlers.requestHandler());
            this.listeners.push({
                config: listenerConfig,
                app,
                resourcesBound: false,
            });
        }
    }

    public bindResource(resourceName: ResourceName, router: Router) {
        const listeners = this.listeners.filter((l) => l.config.resources.includes(resourceName));
        if (listeners.length === 0) {
            throw Error(`No listeners found for resource ${resourceName}`);
        }
        for (const listener of listeners) {
            log.debug(`Registering ${listener.config.bindAddress || "127.0.0.1"}:${listener.config.port} for ${resourceName}`);
            listener.app.use(router);
            listener.resourcesBound = true;
        }
    }

    public finaliseListeners() {
        for (const listener of this.listeners) {
            // By default, Sentry only reports 500+ errors, which is what we want.
            listener.app.use(Handlers.errorHandler());
            listener.app.use((err: unknown, req: Request, res: Response, next: NextFunction) => errorMiddleware(log)(err, req, res, next));
        }
    }

    public getApplicationsForResource(resourceName: ResourceName): Application[] {
        const listeners = this.listeners.filter((l) => l.config.resources.includes(resourceName));
        if (listeners.length === 0) {
            throw Error(`No listener found for resource ${resourceName}`);
        }
        for (const listener of listeners) {
            log.debug(`Reverse binding ${listener.config.bindAddress || "127.0.0.1"}:${listener.config.port} for ${resourceName}`);
            listener.resourcesBound = true;
        }
        return listeners.map(l => l.app);
    }

    public start() {
        for (const listener of this.listeners) {
            if (listener.server) {
                throw Error('Cannot run start() twice');
            }
            const addr = listener.config.bindAddress || "127.0.0.1";
            listener.server = listener.app.listen(listener.config.port, addr);

            // Ensure each listener has a ready probe.
            listener.app.get("/live", (_, res) => res.send({ok: true}));
            listener.app.get("/ready", (_, res) => res.status(listener.resourcesBound ? 200 : 500).send({ready: listener.resourcesBound}));
            log.info(`Listening on http://${addr}:${listener.config.port} for ${listener.config.resources.join(', ')}`)
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
