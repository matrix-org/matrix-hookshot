import YAML from "yaml";
import { promises as fs } from "fs";
import { IAppserviceRegistration } from "matrix-bot-sdk";
import * as assert from "assert";
import { configKey } from "./Decorators";
import { BridgeConfigListener, ResourceTypeArray } from "../ListenerService";
import { GitHubRepoConnectionOptions } from "../Connections/GithubRepo";

interface BridgeConfigGitHubYAML {
    auth: {
        id: number|string;
        privateKeyFile: string;
    };
    webhook: {
        secret: string;
    };
    oauth?: {
        // eslint-disable-next-line camelcase
        client_id: string;
        // eslint-disable-next-line camelcase
        client_secret: string;
        // eslint-disable-next-line camelcase
        redirect_uri: string;
    };
    defaultOptions?: GitHubRepoConnectionOptions;
}

export class BridgeConfigGitHub {
    @configKey("Authentication for the GitHub App.", false)
    auth: {
        id: number|string;
        privateKeyFile: string;
    };
    @configKey("Webhook settings for the GitHub app.", false)
    webhook: {
        secret: string;
    };
    @configKey("Settings for allowing users to sign in via OAuth.", true)
    oauth?: {
        // eslint-disable-next-line camelcase
        client_id: string;
        // eslint-disable-next-line camelcase
        client_secret: string;
        // eslint-disable-next-line camelcase
        redirect_uri: string;
    };
    @configKey("Default options for GitHub connections.", true)
    defaultOptions?: GitHubRepoConnectionOptions;

    constructor(yaml: BridgeConfigGitHubYAML) {
        this.auth = yaml.auth;
        this.webhook = yaml.webhook;
        this.oauth = yaml.oauth;
        this.defaultOptions = yaml.defaultOptions;
    }
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

export interface BridgeConfigFigma {
    instances: {
        name: string,
        webhookPasscode: string;
    }[];
}

export interface BridgeConfigJira {
    webhook: {
        secret: string;
    };
    oauth: {
        // eslint-disable-next-line camelcase
        client_id: string;
        // eslint-disable-next-line camelcase
        client_secret: string;
        // eslint-disable-next-line camelcase
        redirect_uri: string;
    };
}

export interface BridgeGenericWebhooksConfig {
    enabled: boolean;
    urlPrefix: string;
    userIdPrefix?: string;
    allowJsTransformationFunctions?: boolean;
}

interface BridgeWidgetConfig {
    port?: number;
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
    port?: number;
    bindAddress?: string;
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
    port?: number;
    secret: string;
}

export interface BridgeConfigMetrics {
    enabled: boolean;
    bindAddress?: string;
    port?: number;
}

interface BridgeConfigRoot {
    bot?: BridgeConfigBot;
    bridge: BridgeConfigBridge;
    figma?: BridgeConfigFigma;
    generic?: BridgeGenericWebhooksConfig;
    github?: BridgeConfigGitHub;
    gitlab?: BridgeConfigGitLab;
    provisioning?: BridgeConfigProvisioning;
    jira?: BridgeConfigJira;
    logging: BridgeConfigLogging;
    passFile: string;
    queue: BridgeConfigQueue;
    webhook?: BridgeConfigWebhook;
    widgets?: BridgeWidgetConfig;
    metrics?: BridgeConfigMetrics;
    listeners?: BridgeConfigListener[];
}

export class BridgeConfig {
    @configKey("Basic homeserver configuration")
    public readonly bridge: BridgeConfigBridge;
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
    @configKey("Configure this to enable Figma support", true)
    public readonly figma?: BridgeConfigFigma;
    @configKey("Define profile information for the bot user", true)
    public readonly bot?: BridgeConfigBot;
    @configKey("EXPERIMENTAL support for complimentary widgets", true)
    public readonly widgets?: BridgeWidgetConfig;
    @configKey("Provisioning API for integration managers", true)
    public readonly provisioning?: BridgeConfigProvisioning;
    @configKey("Prometheus metrics support", true)
    public readonly metrics?: BridgeConfigMetrics;

    @configKey(`HTTP Listener configuration.
 Bind resource endpoints to ports and addresses.
 'port' must be specified. Each listener must listen on a unique port.
 'bindAddress' will default to '127.0.0.1' if not specified, which may not be suited to Docker environments.
 'resources' may be any of ${ResourceTypeArray.join(', ')}`, true)
    public readonly listeners: BridgeConfigListener[];

    constructor(configData: BridgeConfigRoot, env: {[key: string]: string|undefined}) {
        this.bridge = configData.bridge;
        assert.ok(this.bridge);
        this.github = configData.github && new BridgeConfigGitHub(configData.github);
        if (this.github?.auth && env["GITHUB_PRIVATE_KEY_FILE"]) {
            this.github.auth.privateKeyFile = env["GITHUB_PRIVATE_KEY_FILE"];
        }
        if (this.github?.oauth && env["GITHUB_OAUTH_REDIRECT_URI"]) {
            this.github.oauth.redirect_uri = env["GITHUB_OAUTH_REDIRECT_URI"];
        }
        this.gitlab = configData.gitlab;
        this.jira = configData.jira;
        this.generic = configData.generic;
        this.figma = configData.figma;
        this.provisioning = configData.provisioning;
        this.passFile = configData.passFile;
        this.bot = configData.bot;
        this.metrics = configData.metrics;
        this.queue = configData.queue || {
            monolithic: true,
        };
        this.logging = configData.logging || {
            level: "info",
        }


        if (!this.github && !this.gitlab && !this.jira && !this.generic) {
            throw Error("Config is not valid: At least one of GitHub, GitLab, JIRA or generic hooks must be configured");
        }

        // TODO: Formalize env support
        if (env.CFG_QUEUE_MONOLITHIC && ["false", "off", "no"].includes(env.CFG_QUEUE_MONOLITHIC)) {
            this.queue.monolithic = false;
            this.queue.host = env.CFG_QUEUE_HOST;
            this.queue.port = env.CFG_QUEUE_POST ? parseInt(env.CFG_QUEUE_POST, 10) : undefined;
        }

        // Listeners is a bit special
        this.listeners = configData.listeners || [];

        // For legacy reasons, copy across the per-service listener config into the listeners array.
        if (configData.webhook?.port) {
            this.listeners.push({
                resources: ['webhooks'],
                port: configData.webhook.port,
                bindAddress: configData.webhook.bindAddress,
            })
        }

        if (this.provisioning?.port) {
            this.listeners.push({
                resources: ['provisioning'],
                port: this.provisioning.port,
                bindAddress: this.provisioning.bindAddress,
            })
        }
        
        if (this.metrics?.port) {
            this.listeners.push({
                resources: ['metrics'],
                port: this.metrics.port,
                bindAddress: this.metrics.bindAddress,
            })
        }
        
        if (this.widgets?.port) {
            this.listeners.push({
                resources: ['widgets'],
                port: this.widgets.port,
            })
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


// Can be called directly
if (require.main === module) {
    BridgeConfig.parseConfig(process.argv[2] || "config.yml", process.env).then(() => {
        // eslint-disable-next-line no-console
        console.log('Config successfully validated.');
        process.exit(0);
    }).catch(ex => {
        // eslint-disable-next-line no-console
        console.error('Error in config:', ex);
        process.exit(1);
    });
}
