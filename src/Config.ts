import YAML from "yaml";
import { promises as fs } from "fs"
import { IAppserviceRegistration } from "matrix-bot-sdk";

export interface BridgeConfig {
    github: {
        auth: string
        webhook: {
            port: number
            bindAddress: string
            secret: string
        },
        userTokens: {
            [userId: string]: string
        }
        passFile: string,
    },
    bridge: {
        domain: string
        url: string
        port: number,
        bindAddress: string
    },
    queue: {
        monolithic: boolean,
        port?: number,
        host?: string,
    }
}

export async function parseRegistrationFile(filename: string) {
    const file = await fs.readFile(filename, "utf-8");
    return YAML.parse(file) as IAppserviceRegistration;
}

export async function parseConfig(filename: string) {
    const file = await fs.readFile(filename, "utf-8");
    const config = YAML.parse(file) as BridgeConfig;
    config.queue = config.queue || {
        monolithic: true,
    };
    return config;
}