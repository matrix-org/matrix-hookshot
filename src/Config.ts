import YAML from "yaml";
import { promises as fs } from "fs";
import { IAppserviceRegistration } from "matrix-bot-sdk";

export interface BridgeConfig {
    github: {
        auth: string;
        webhook: {
            port: number;
            bindAddress: string;
            secret: string;
        },
        userTokens: {
            [userId: string]: string;
        }
        passFile: string;
        oauth: {
            client_id: string;
            client_secret: string;
            redirect_uri: string;
        };
    };
    bridge: {
        domain: string;
        url: string;
        mediaUrl: string;
        port: number;
        bindAddress: string;
        store: string;
    };
    queue: {
        monolithic: boolean;
        port?: number;
        host?: string;
    };
    logging: {
        level: string;
    };
}

export async function parseRegistrationFile(filename: string) {
    const file = await fs.readFile(filename, "utf-8");
    return YAML.parse(file) as IAppserviceRegistration;
}

export async function parseConfig(filename: string, env: {[key: string]: string|undefined}) {
    const file = await fs.readFile(filename, "utf-8");
    const config = YAML.parse(file) as BridgeConfig;
    config.queue = config.queue || {
        monolithic: true,
    };
    if (!config.logging || !config.logging.level) {
        config.logging = {
            level: "info",
        };
    }
    config.bridge.mediaUrl = config.bridge.mediaUrl || config.bridge.url;
    if (env.CFG_QUEUE_MONOLITHIC && ["false", "off", "no"].includes(env.CFG_QUEUE_MONOLITHIC)) {
        config.queue.monolithic = false;
        config.queue.host = env.CFG_QUEUE_HOST;
        config.queue.port = env.CFG_QUEUE_POST ? parseInt(env.CFG_QUEUE_POST, 10) : undefined;
    }
    return config;
}
