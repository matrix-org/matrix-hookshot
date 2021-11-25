import YAML from "yaml";
import { promises as fs } from "fs";
import { IAppserviceRegistration } from "matrix-bot-sdk";
import * as assert from "assert";
import { configKey } from "./Decorators";

export interface BridgeConfigGitHub {
    auth: {
        id: number|string;
        privateKeyFile: string;
    };
    webhook: {
        secret: string;
    },
    oauth: {
        // eslint-disable-next-line camelcase
        client_id: string;
        // eslint-disable-next-line camelcase
        client_secret: string;
        // eslint-disable-next-line camelcase
        redirect_uri: string;
    };
    installationId: number|string;
}

export interface GitLabInstance {
    url: string;
    // oauth: {
    //     client_id: string;
    //     client_secret: string;
    //     redirect_uri: string;
    // };
}

interface BridgeConfigGitLab {
    webhook: {
        secret: string;
    },
    instances: {[name: string]: GitLabInstance};
}

interface BridgeConfigJira {
    webhook: {
        secret: string;
    };
}

interface BridgeGenericWebhooksConfig {
    enabled: boolean;
    allowJsTransformationFunctions?: boolean;
}

interface BridgeWidgetConfig {
    port: number;
    addToAdminRooms: boolean;
    publicUrl: string;
}

interface BridgeConfigBridge {
    domain: string;
    url: string;
    mediaUrl?: string;
    port: number;
    bindAddress: string;
    pantalaimon?: {
        url: string;
        username: string;
        password: string;
    }
}

interface BridgeConfigWebhook {
    port: number;
    bindAddress: string;
}

interface BridgeConfigQueue {
    monolithic: boolean;
    port?: number;
    host?: string;
}

interface BridgeConfigLogging {
    level: string;
}

interface BridgeConfigBot {
    displayname?: string;
    avatar?: string;
}

export interface BridgeConfigProvisioning {
    bindAddress?: string;
    port: number;
    secret: string;
}

interface BridgeConfigRoot {
    bridge: BridgeConfigBridge;
    webhook: BridgeConfigWebhook;
    queue: BridgeConfigQueue;
    logging: BridgeConfigLogging;
    passFile: string;
    github?: BridgeConfigGitHub;
    gitlab?: BridgeConfigGitLab;
    provisioning?: BridgeConfigProvisioning;
    jira?: BridgeConfigJira;
    bot?: BridgeConfigBot;
    widgets?: BridgeWidgetConfig;
    generic?: BridgeGenericWebhooksConfig;
}

export class BridgeConfig {
    @configKey("Basic homeserver configuration")
    public readonly bridge: BridgeConfigBridge;
    @configKey("HTTP webhook listener options")
    public readonly webhook: BridgeConfigWebhook;
    @configKey("Message queue / cache configuration options for large scale deployments", true)
    public readonly queue: BridgeConfigQueue;
    @configKey("Logging settings. You can have a severity debug,info,warn,error", true)
    public readonly logging: BridgeConfigLogging;
    @configKey(`A passkey used to encrypt tokens stored inside the bridge.
 Run openssl genpkey -out passkey.pem -outform PEM -algorithm RSA -pkeyopt rsa_keygen_bits:4096 to generate`)
    public readonly passFile: string;
    @configKey("Configure this to enable GitHub support", true)
    public readonly github?: BridgeConfigGitHub;
    @configKey("Configure this to enable GitLab support", true)
    public readonly gitlab?: BridgeConfigGitLab;
    @configKey("Configure this to enable Jira support", true)
    public readonly jira?: BridgeConfigJira;
    @configKey("Support for generic webhook events. `allowJsTransformationFunctions` will allow users to write short transformation snippets in code, and thus is unsafe in untrusted environments", true)
    public readonly generic?: BridgeGenericWebhooksConfig;
    @configKey("Define profile information for the bot user", true)
    public readonly bot?: BridgeConfigBot;
    @configKey("EXPERIMENTAL support for complimentary widgets", true)
    public readonly widgets?: BridgeWidgetConfig;
    @configKey("Provisioning API for integration managers", true)
    public readonly provisioning?: BridgeConfigProvisioning;

    constructor(configData: BridgeConfigRoot, env: {[key: string]: string|undefined}) {
        this.bridge = configData.bridge;
        assert.ok(this.bridge);
        this.github = configData.github;
        if (this.github?.auth && env["GITHUB_PRIVATE_KEY_FILE"]) {
            this.github.auth.privateKeyFile = env["GITHUB_PRIVATE_KEY_FILE"];
        }
        if (this.github?.oauth && env["GITHUB_OAUTH_REDIRECT_URI"]) {
            this.github.oauth.redirect_uri = env["GITHUB_OAUTH_REDIRECT_URI"];
        }
        this.gitlab = configData.gitlab;
        this.jira = configData.jira;
        this.generic = configData.generic;
        this.webhook = configData.webhook;
        this.provisioning = configData.provisioning;
        this.passFile = configData.passFile;
        assert.ok(this.webhook);
        this.queue = configData.queue || {
            monolithic: true,
        };
        this.logging = configData.logging || {
            level: "info",
        }
        // TODO: Formalize env support
        if (env.CFG_QUEUE_MONOLITHIC && ["false", "off", "no"].includes(env.CFG_QUEUE_MONOLITHIC)) {
            this.queue.monolithic = false;
            this.queue.host = env.CFG_QUEUE_HOST;
            this.queue.port = env.CFG_QUEUE_POST ? parseInt(env.CFG_QUEUE_POST, 10) : undefined;
        }

    }

    static async parseConfig(filename: string, env: {[key: string]: string|undefined}) {
        const file = await fs.readFile(filename, "utf-8");
        return new BridgeConfig(YAML.parse(file), env);
    }
}

export async function parseRegistrationFile(filename: string) {
    const file = await fs.readFile(filename, "utf-8");
    return YAML.parse(file) as IAppserviceRegistration;
}