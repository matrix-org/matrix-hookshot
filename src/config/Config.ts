import YAML from "yaml";
import { promises as fs } from "fs";
import { IAppserviceRegistration, LogLevel, MatrixClient } from "matrix-bot-sdk";
import * as assert from "assert";
import { configKey, hideKey } from "./Decorators";
import { BridgeConfigListener, ResourceTypeArray } from "../ListenerService";
import { GitHubRepoConnectionOptions } from "../Connections/GithubRepo";
import { BridgeConfigActorPermission, BridgePermissions } from "../libRs";
import { ConfigError } from "../errors";
import { ApiError, ErrCode } from "../api";
import { GithubInstance, GITHUB_CLOUD_URL } from "../github/GithubInstance";
import { DefaultDisallowedIpRanges, Logger } from "matrix-appservice-bridge";
import { BridgeConfigCache } from "./sections/cache";
import { BridgeConfigQueue } from "./sections";

const log = new Logger("Config");

function makePrefixedUrl(urlString: string): URL {
    return new URL(urlString.endsWith("/") ? urlString : urlString + "/");
}

export const ValidLogLevelStrings = [
    LogLevel.ERROR.toString(),
    LogLevel.WARN.toString(),
    LogLevel.INFO.toString(),
    LogLevel.DEBUG.toString(),
    LogLevel.TRACE.toString(),
].map(l => l.toLowerCase());

// Maps to permission_level_to_int in permissions.rs
export enum BridgePermissionLevel {
    "commands" = 1,
    login = 2,
    notifications = 3,
    manageConnections = 4,
    admin = 5,
}

interface BridgeConfigGitHubYAML {
    enterpriseUrl?: string;
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
    userIdPrefix?: string;
}

export class BridgeConfigGitHub {
    @configKey("Authentication for the GitHub App.", false)
    readonly auth: {
        id: number|string;
        privateKeyFile: string;
    };
    @configKey("Webhook settings for the GitHub app.", false)
    readonly webhook: {
        secret: string;
    };
    @configKey("Settings for allowing users to sign in via OAuth.", true)
    readonly oauth?: {
        // eslint-disable-next-line camelcase
        client_id: string;
        // eslint-disable-next-line camelcase
        client_secret: string;
        // eslint-disable-next-line camelcase
        redirect_uri: string;
    };
    @configKey("Default options for GitHub connections.", true)
    readonly defaultOptions?: GitHubRepoConnectionOptions;

    @configKey("Prefix used when creating ghost users for GitHub accounts.", true)
    readonly userIdPrefix: string;

    @configKey("URL for enterprise deployments. Does not include /api/v3", true)
    private enterpriseUrl?: string;

    @hideKey()
    public readonly baseUrl: URL;

    constructor(yaml: BridgeConfigGitHubYAML) {
        this.auth = yaml.auth;
        this.webhook = yaml.webhook;
        this.oauth = yaml.oauth;
        this.defaultOptions = yaml.defaultOptions;
        this.userIdPrefix = yaml.userIdPrefix || "_github_";
        this.baseUrl = yaml.enterpriseUrl ? new URL(yaml.enterpriseUrl) : GITHUB_CLOUD_URL;
    }

    public publicConfig(githubInstance?: GithubInstance) {
        return {
            userIdPrefix: this.userIdPrefix,
            newInstallationUrl: githubInstance?.newInstallationUrl?.toString(),
        }
    }
}

export interface BridgeConfigJiraCloudOAuth {
    // eslint-disable-next-line camelcase
    client_id: string;
    // eslint-disable-next-line camelcase
    client_secret: string;
    // eslint-disable-next-line camelcase
    redirect_uri: string;
}

export interface BridgeConfigJiraOnPremOAuth {
    consumerKey: string;
    privateKey: string;
    // eslint-disable-next-line camelcase
    redirect_uri: string;
}

export interface BridgeConfigJiraYAML {
    webhook: {
        secret: string;
    };
    url?: string,
    oauth?: BridgeConfigJiraCloudOAuth|BridgeConfigJiraOnPremOAuth;

}
export class BridgeConfigJira implements BridgeConfigJiraYAML {
    static CLOUD_INSTANCE_NAME = "api.atlassian.com";

    @configKey("Webhook settings for JIRA")
    readonly webhook: {
        secret: string;
    };

    // To hide the undefined for now
    @hideKey()
    @configKey("URL for the instance if using on prem. Ignore if targetting cloud (atlassian.net)", true)
    readonly url?: string;
    @configKey("OAuth settings for connecting users to JIRA. See documentation for more information", true)
    readonly oauth?: BridgeConfigJiraCloudOAuth|BridgeConfigJiraOnPremOAuth;

    @hideKey()
    readonly instanceUrl?: URL;

    @hideKey()
    readonly instanceName: string;

    constructor(yaml: BridgeConfigJiraYAML) {
        assert.ok(yaml.webhook);
        assert.ok(yaml.webhook.secret);
        this.webhook = yaml.webhook;
        this.url = yaml.url;
        this.instanceUrl = yaml.url !== undefined ? new URL(yaml.url) : undefined;
        this.instanceName = this.instanceUrl?.host || BridgeConfigJira.CLOUD_INSTANCE_NAME;
        if (!yaml.oauth) {
            return;
        }
        let oauth: BridgeConfigJiraCloudOAuth|BridgeConfigJiraOnPremOAuth;

        assert.ok(yaml.oauth.redirect_uri);
        // Validate oauth settings
        if (this.url) {
            // On-prem
            oauth = yaml.oauth as BridgeConfigJiraOnPremOAuth;
            assert.ok(oauth.consumerKey);
            assert.ok(oauth.privateKey);
        } else {
            // Cloud
            oauth = yaml.oauth as BridgeConfigJiraCloudOAuth;
            assert.ok(oauth.client_id);
            assert.ok(oauth.client_secret);
        }
        this.oauth = oauth;
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

export interface BridgeConfigGitLabYAML {
    webhook: {
        publicUrl?: string;
        secret: string;
    },
    instances: {[name: string]: GitLabInstance};
    userIdPrefix: string;
    commentDebounceMs?: number;
}

export class BridgeConfigGitLab {
    readonly instances: {[name: string]: GitLabInstance};
    readonly webhook: {
        publicUrl?: string;
        secret: string;
    };

    @configKey("Prefix used when creating ghost users for GitLab accounts.", true)
    readonly userIdPrefix: string;

    @configKey("Aggregate comments by waiting this many miliseconds before posting them to Matrix. Defaults to 5000 (5 seconds)", true)
    readonly commentDebounceMs: number;

    constructor(yaml: BridgeConfigGitLabYAML) {
        this.instances = yaml.instances;
        this.webhook = yaml.webhook;
        this.userIdPrefix = yaml.userIdPrefix || "_gitlab_";

        for (const name in this.instances) {
            const url = this.instances[name].url;
            if (url.endsWith("/")) {
                this.instances[name].url = url.slice(0, -1);
            }
        }

        if (yaml.commentDebounceMs === undefined) {
            this.commentDebounceMs = 5000;
        } else {
            this.commentDebounceMs = yaml.commentDebounceMs;
        }
    }

    @hideKey()
    public get publicConfig() {
        return {
            userIdPrefix: this.userIdPrefix,
        }
    }


    public getInstanceByProjectUrl(url: string): {name: string, instance: GitLabInstance}|null {
        for (const [name, instance] of Object.entries(this.instances)) {
            if (url.startsWith(instance.url)) {
                return {name, instance};
            }
        }
        return null;
    }
}

export interface BridgeConfigFeedsYAML {
    enabled: boolean;
    pollIntervalSeconds?: number;
    pollConcurrency?: number;
    pollTimeoutSeconds?: number;
}

export class BridgeConfigFeeds {
    public enabled: boolean;
    public pollIntervalSeconds: number;
    public pollTimeoutSeconds: number;
    public pollConcurrency: number;

    constructor(yaml: BridgeConfigFeedsYAML) {
        this.enabled = yaml.enabled;
        this.pollConcurrency = yaml.pollConcurrency ?? 4;
        this.pollIntervalSeconds = yaml.pollIntervalSeconds ?? 600;
        assert.strictEqual(typeof this.pollIntervalSeconds, "number");
        this.pollTimeoutSeconds = yaml.pollTimeoutSeconds ?? 30;
        assert.strictEqual(typeof this.pollTimeoutSeconds, "number");
    }

    @hideKey()
    public get publicConfig() {
        return {
            pollIntervalSeconds: this.pollIntervalSeconds,
        }
    }
}

export interface BridgeConfigFigma {
    publicUrl: string;
    overrideUserId?: string;
    instances: {[name: string]: {
        teamId: string;
        accessToken: string;
        passcode: string;
    }};
}

export interface BridgeGenericWebhooksConfigYAML {
    enabled: boolean;
    urlPrefix: string;
    userIdPrefix?: string;
    allowJsTransformationFunctions?: boolean;
    waitForComplete?: boolean;
    enableHttpGet?: boolean;
    outbound?: boolean;
    disallowedIpRanges?: string[];
}

export class BridgeConfigGenericWebhooks {
    public readonly enabled: boolean;
    public readonly outbound: boolean;

    @hideKey()
    public readonly parsedUrlPrefix: URL;
    public readonly urlPrefix: () => string;

    public readonly userIdPrefix?: string;
    public readonly allowJsTransformationFunctions?: boolean;
    public readonly waitForComplete?: boolean;
    public readonly enableHttpGet: boolean;
    constructor(yaml: BridgeGenericWebhooksConfigYAML) {
        this.enabled = yaml.enabled || false;
        this.outbound = yaml.outbound || false;
        this.enableHttpGet = yaml.enableHttpGet || false;
        try {
            this.parsedUrlPrefix = makePrefixedUrl(yaml.urlPrefix);
            this.urlPrefix = () => { return this.parsedUrlPrefix.href; }
        } catch (err) {
            throw new ConfigError("generic.urlPrefix", "is not defined or not a valid URL");
        }
        this.userIdPrefix = yaml.userIdPrefix;
        this.allowJsTransformationFunctions = yaml.allowJsTransformationFunctions;
        this.waitForComplete = yaml.waitForComplete;
    }

    @hideKey()
    public get publicConfig() {
        return {
            userIdPrefix: this.userIdPrefix,
            allowJsTransformationFunctions: this.allowJsTransformationFunctions,
            waitForComplete: this.waitForComplete,
        }
    }

}


interface BridgeWidgetConfigYAML {
    publicUrl: string;
    /**
     * @deprecated Prefer using listener config.
     */
    port?: number;
    addToAdminRooms?: boolean;
    roomSetupWidget?: {
        addOnInvite?: boolean;
    };
    disallowedIpRanges?: string[];
    branding?: {
        widgetTitle: string,
    }
    openIdOverrides?: Record<string, string>;
}

export class BridgeWidgetConfig {
    public readonly addToAdminRooms: boolean;

    @hideKey()
    public readonly parsedPublicUrl: URL;
    public readonly publicUrl: () => string;

    public readonly roomSetupWidget?: {
        addOnInvite?: boolean;
    };
    public readonly disallowedIpRanges?: string[];
    public readonly branding: {
        widgetTitle: string,
    }

    @hideKey()
    public readonly openIdOverrides?: Record<string, URL>;
    constructor(yaml: BridgeWidgetConfigYAML) {
        this.addToAdminRooms = yaml.addToAdminRooms || false;
        this.disallowedIpRanges = yaml.disallowedIpRanges;
        this.roomSetupWidget = yaml.roomSetupWidget;
        if (yaml.disallowedIpRanges !== undefined && (!Array.isArray(yaml.disallowedIpRanges) || !yaml.disallowedIpRanges.every(s => typeof s === "string"))) {
            throw new ConfigError("widgets.disallowedIpRanges", "must be a string array");
        }
        try {
            this.parsedPublicUrl = makePrefixedUrl(yaml.publicUrl)
            this.publicUrl = () => { return this.parsedPublicUrl.href; }
        } catch (err) {
            throw new ConfigError("widgets.publicUrl", "is not defined or not a valid URL");
        }
        this.branding = yaml.branding || {
            widgetTitle: "Hookshot Configuration"
        };
        if (yaml.openIdOverrides) {
            this.openIdOverrides = {};
            for (const [serverName, urlStr] of Object.entries(yaml.openIdOverrides)) {
                this.openIdOverrides[serverName] = new URL(urlStr);
            }
        }
    }
}


interface BridgeConfigBridge {
    domain: string;
    url: string;
    mediaUrl?: string;
    port: number;
    bindAddress: string;
    // Removed
    pantalaimon?: never;
}

interface BridgeConfigWebhook {
    port?: number;
    bindAddress?: string;
}

export interface BridgeConfigLogging {
    level: "debug"|"info"|"warn"|"error"|"trace";
    json?: boolean;
    colorize?: boolean;
    timestampFormat?: string;
}

interface BridgeConfigBot {
    displayname?: string;
    avatar?: string;
}
interface BridgeConfigEncryption {
    storagePath: string;
    useLegacySledStore: boolean;
}

export interface BridgeConfigServiceBot {
    localpart: string;
    displayname?: string;
    avatar?: string;
    prefix: string;
    service: string;
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

export interface BridgeConfigSentry {
    dsn: string;
    environment?: string;
}

export interface BridgeConfigChallengeHound {
    token?: string;
}


export interface BridgeConfigRoot {
    bot?: BridgeConfigBot;
    bridge: BridgeConfigBridge;
    cache?: BridgeConfigCache;
    experimentalEncryption?: BridgeConfigEncryption;
    feeds?: BridgeConfigFeedsYAML;
    figma?: BridgeConfigFigma;
    generic?: BridgeGenericWebhooksConfigYAML;
    github?: BridgeConfigGitHubYAML;
    gitlab?: BridgeConfigGitLabYAML;
    jira?: BridgeConfigJiraYAML;
    listeners?: BridgeConfigListener[];
    logging: BridgeConfigLogging;
    metrics?: BridgeConfigMetrics;
    passFile: string;
    permissions?: BridgeConfigActorPermission[];
    provisioning?: BridgeConfigProvisioning;
    queue?: BridgeConfigQueue;
    sentry?: BridgeConfigSentry;
    serviceBots?: BridgeConfigServiceBot[];
    webhook?: BridgeConfigWebhook;
    widgets?: BridgeWidgetConfigYAML;
    challengeHound?: BridgeConfigChallengeHound;
}

export class BridgeConfig {
    @configKey("Basic homeserver configuration")
    public readonly bridge: BridgeConfigBridge;
    @configKey(`Cache options for large scale deployments. 
    For encryption to work, this must be configured.`, true)
    public readonly cache?: BridgeConfigCache;
    @configKey(`Configuration for encryption support in the bridge.
 If omitted, encryption support will be disabled.
 This feature is HIGHLY EXPERIMENTAL AND SUBJECT TO CHANGE.
 For more details, see https://github.com/matrix-org/matrix-hookshot/issues/594.`, true)
    public readonly encryption?: BridgeConfigEncryption;
    @configKey(`Message queue configuration options for large scale deployments.
 For encryption to work, this must not be configured.`, true)
    public readonly queue?: Omit<BridgeConfigQueue, "monolithic">;
    @configKey("Logging settings. You can have a severity debug,info,warn,error")
    public readonly logging: BridgeConfigLogging;
    @configKey(`Permissions for using the bridge. See docs/setup.md#permissions for help`, true)
    public readonly permissions: BridgeConfigActorPermission[];
    @configKey(`A passkey used to encrypt tokens stored inside the bridge.
 Run openssl genpkey -out passkey.pem -outform PEM -algorithm RSA -pkeyopt rsa_keygen_bits:4096 to generate`)
    public readonly passFile: string;
    @configKey("Configure this to enable GitHub support", true)
    public readonly github?: BridgeConfigGitHub;
    @configKey("Configure this to enable GitLab support", true)
    public readonly gitlab?: BridgeConfigGitLab;
    @configKey("Configure this to enable Jira support. Only specify `url` if you are using a On Premise install (i.e. not atlassian.com)", true)
    public readonly jira?: BridgeConfigJira;
    @configKey(`Support for generic webhook events.
'allowJsTransformationFunctions' will allow users to write short transformation snippets in code, and thus is unsafe in untrusted environments
`, true)
    public readonly generic?: BridgeConfigGenericWebhooks;
    @configKey("Configure this to enable Figma support", true)
    public readonly figma?: BridgeConfigFigma;
    @configKey("Configure this to enable RSS/Atom feed support", true)
    public readonly feeds?: BridgeConfigFeeds;
    @configKey("Configure Challenge Hound support", true)
    public readonly challengeHound?: BridgeConfigChallengeHound;
    @configKey("Define profile information for the bot user", true)
    public readonly bot?: BridgeConfigBot;
    @configKey("Define additional bot users for specific services", true)
    public readonly serviceBots?: BridgeConfigServiceBot[];
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
 'resources' may be any of ${ResourceTypeArray.join(', ')}`)
    public readonly listeners: BridgeConfigListener[];

    @configKey("Configure Sentry error reporting", true)
    public readonly sentry?: BridgeConfigSentry;

    @hideKey()
    private readonly bridgePermissions: BridgePermissions;



    constructor(configData: BridgeConfigRoot, env?: {[key: string]: string|undefined}) {
        this.bridge = configData.bridge;
        assert.ok(this.bridge);
        this.github = configData.github && new BridgeConfigGitHub(configData.github);
        if (this.github?.auth && env?.["GITHUB_PRIVATE_KEY_FILE"]) {
            this.github.auth.privateKeyFile = env?.["GITHUB_PRIVATE_KEY_FILE"];
        }
        if (this.github?.oauth && env?.["GITHUB_OAUTH_REDIRECT_URI"]) {
            this.github.oauth.redirect_uri = env?.["GITHUB_OAUTH_REDIRECT_URI"];
        }
        this.gitlab = configData.gitlab && new BridgeConfigGitLab(configData.gitlab);
        this.figma = configData.figma;
        this.jira = configData.jira && new BridgeConfigJira(configData.jira);
        this.generic = configData.generic && new BridgeConfigGenericWebhooks(configData.generic);
        this.feeds = configData.feeds && new BridgeConfigFeeds(configData.feeds);
        this.provisioning = configData.provisioning;
        this.passFile = configData.passFile ?? "./passkey.pem";
        this.bot = configData.bot;
        this.serviceBots = configData.serviceBots;
        this.metrics = configData.metrics;
        this.challengeHound = configData.challengeHound;

        // TODO: Formalize env support
        if (env?.CFG_QUEUE_MONOLITHIC && ["false", "off", "no"].includes(env.CFG_QUEUE_MONOLITHIC)) {
            if (!env?.CFG_QUEUE_HOST) {
                throw new ConfigError("env:CFG_QUEUE_HOST", "CFG_QUEUE_MONOLITHIC was defined but host was not");
            }
            configData.queue = {
                monolithic: false,
                host: env?.CFG_QUEUE_HOST,
                port: env?.CFG_QUEUE_POST ? parseInt(env?.CFG_QUEUE_POST, 10) : undefined,
            }
        }

        this.cache = configData.cache;
        this.queue = configData.queue;

        if (configData.queue?.monolithic !== undefined) {
            log.warn("The `queue.monolithic` config option is deprecated. Instead, configure the `cache` section.");
            this.cache = {
                redisUri: 'redisUri' in configData.queue ? configData.queue.redisUri
                    : `redis://${configData.queue.host ?? 'localhost'}:${configData.queue.port ?? 6379}`
            };
            // If monolithic, disable the redis queue.
            if (configData.queue.monolithic === true) {
                this.queue = undefined;
            }
        }

        this.encryption = configData.experimentalEncryption;


        this.logging = configData.logging || {
            level: "info",
        }

        this.widgets = configData.widgets && new BridgeWidgetConfig(configData.widgets);
        this.sentry = configData.sentry;

        // To allow DEBUG as well as debug
        this.logging.level = this.logging.level.toLowerCase() as "debug"|"info"|"warn"|"error"|"trace";
        if (!ValidLogLevelStrings.includes(this.logging.level)) {
            throw new ConfigError("logging.level", `Logging level is not valid. Must be one of ${ValidLogLevelStrings.join(', ')}`)
        }

        this.permissions = configData.permissions || [{
            actor: this.bridge.domain,
            services: [{
                service: '*',
                level: BridgePermissionLevel[BridgePermissionLevel.admin],
            }]
        }];
        this.bridgePermissions = new BridgePermissions(this.permissions);

        if (!configData.permissions) {
            log.warn(`You have not configured any permissions for the bridge, which by default means all users on ${this.bridge.domain} have admin levels of control. Please adjust your config.`);
        }

        if (!this.github && !this.gitlab && !this.jira && !this.generic && !this.figma && !this.feeds) {
            throw Error("Config is not valid: At least one of GitHub, GitLab, JIRA, Figma, feeds or generic hooks must be configured");
        }

        if ('goNebMigrator' in configData) {
            log.warn(`The GoNEB migrator has been removed from this release. You should remove the 'goNebMigrator' from your config.`);
        }

        // Listeners is a bit special
        this.listeners = configData.listeners || [];

        // For legacy reasons, copy across the per-service listener config into the listeners array.
        if (configData.webhook?.port) {
            this.listeners.push({
                resources: ['webhooks'],
                port: configData.webhook.port,
                bindAddress: configData.webhook.bindAddress,
            });
            log.warn("The `webhook` configuration still specifies a port/bindAddress. This should be moved to the `listeners` config.");
        }

        if (configData.widgets?.port) {
            this.listeners.push({
                resources: ['widgets'],
                port: configData.widgets.port,
            })
        }

        if (this.provisioning?.port) {
            this.listeners.push({
                resources: ['provisioning'],
                port: this.provisioning.port,
                bindAddress: this.provisioning.bindAddress,
            })
            log.warn("The `provisioning` configuration still specifies a port/bindAddress. This should be moved to the `listeners` config.");
        }

        if (this.metrics?.port) {
            this.listeners.push({
                resources: ['metrics'],
                port: this.metrics.port,
                bindAddress: this.metrics.bindAddress,
            })
            log.warn("The `metrics` configuration still specifies a port/bindAddress. This should be moved to the `listeners` config.");
        }

        if (configData.widgets?.port) {
            this.listeners.push({
                resources: ['widgets'],
                port: configData.widgets.port,
            });
            log.warn("The `widgets` configuration still specifies a port/bindAddress. This should be moved to the `listeners` config.");
        }

        const hasWidgetListener = !!this.listeners.find(l => l.resources.includes('widgets'));
        if (this.widgets && !hasWidgetListener) {
            throw new ConfigError(`listeners`, "You have enabled the widgets feature, but not included a widgets listener.");
        }

        if (this.widgets && this.widgets.openIdOverrides) {
            log.warn("The `widgets.openIdOverrides` config value SHOULD NOT be used in a production environment.")
        }

        if (this.bridge.pantalaimon) {
            throw new ConfigError("bridge.pantalaimon", "Pantalaimon support has been removed. Encrypted bridges should now use the `experimentalEncryption` config option");
        }

        if (this.encryption) {
            log.warn(`
You have enabled encryption support in the bridge. This feature is HIGHLY EXPERIMENTAL AND SUBJECT TO CHANGE.
For more details, see https://github.com/matrix-org/matrix-hookshot/issues/594.
            `);

            if (!this.encryption.storagePath) {
                throw new ConfigError("experimentalEncryption.storagePath", "The crypto storage path must not be empty.");
            }

            if (this.encryption.useLegacySledStore) {
                throw new ConfigError(
                    "experimentalEncryption.useLegacySledStore", `
The Sled crypto store format is no longer supported.
Please back up your crypto store at ${this.encryption.storagePath},
remove "useLegacySledStore" from your configuration file, and restart Hookshot.
                `);
            }
            if (!this.cache) {
                throw new ConfigError("cache", "Encryption requires the Redis cache to be enabled.");
            }

            if (this.queue) {
                throw new ConfigError("queue", "Encryption does not support message queues.");
            }
        }

        if (this.figma?.overrideUserId) {
            log.warn("The `figma.overrideUserId` config value is deprecated. A service bot should be configured instead.");
        }
    }

    public async prefillMembershipCache(client: MatrixClient) {
        const permissionRooms = this.bridgePermissions.getInterestedRooms();
        log.info(`Prefilling room membership for permissions for ${permissionRooms.length} rooms`);
        for(const roomEntry of permissionRooms) {
            const membership = await client.getJoinedRoomMembers(await client.resolveRoom(roomEntry));
            membership.forEach(userId => this.bridgePermissions.addMemberToCache(roomEntry, userId));
            log.debug(`Found ${membership.length} users for ${roomEntry}`);
        }
    }

    public addMemberToCache(roomId: string, userId: string) {
        this.bridgePermissions.addMemberToCache(roomId, userId);
    }

    public removeMemberFromCache(roomId: string, userId: string) {
        this.bridgePermissions.removeMemberFromCache(roomId, userId);
    }

    public checkPermissionAny(mxid: string, permission: BridgePermissionLevel) {
        return this.bridgePermissions.checkActionAny(mxid, BridgePermissionLevel[permission]);
    }

    public checkPermission(mxid: string, service: string, permission: BridgePermissionLevel) {
        return this.bridgePermissions.checkAction(mxid, service, BridgePermissionLevel[permission]);
    }

    public get enabledServices(): string[] {
        const services = [];
        if (this.feeds && this.feeds.enabled) {
            services.push("feeds");
        }
        if (this.figma) {
            services.push("figma");
        }
        if (this.generic && this.generic.enabled) {
            services.push("generic");
            if (this.generic.outbound) {
                services.push("genericOutbound");
            }
        }
        if (this.github) {
            services.push("github");
        }
        if (this.gitlab) {
            services.push("gitlab");
        }
        if (this.jira) {
            services.push("jira");
        }
        if (this.challengeHound) {
            services.push("challengehound");
        }
        return services;
    }

    public getPublicConfigForService(serviceName: string): Record<string, unknown> {
        let config: undefined|Record<string, unknown>;
        switch (serviceName) {
            case "feeds":
                config = this.feeds?.publicConfig;
                break;
            case "generic":
                config = this.generic?.publicConfig;
                break;
            case "github":
                config = this.github?.publicConfig();
                break;
            case "gitlab":
                config = this.gitlab?.publicConfig;
                break;
            case "genericOutbound":
            case "jira":
                config = {};
                break;
            default:
                throw new ApiError("Not a known service, or service doesn't expose a config", ErrCode.NotFound);
        }

        if (!config) {
            throw new ApiError("Service is not enabled", ErrCode.DisabledFeature);
        }
        return config;
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
    Logger.configure({console: "info"});
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
