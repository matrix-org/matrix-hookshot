/* eslint-disable no-console */

import YAML from "yaml";
import { promises as fs } from "fs";
import {
  IAppserviceRegistration,
  LogLevel,
  MatrixClient,
} from "matrix-bot-sdk";
import * as assert from "assert";
import { configKey, hideKey } from "./Decorators";
import { BridgeConfigListener, ResourceTypeArray } from "../ListenerService";
import { BridgeConfigActorPermission, BridgePermissions } from "../libRs";
import { ConfigError } from "../Errors";
import { ApiError, ErrCode } from "../api";
import { Logger } from "matrix-appservice-bridge";
import { BridgeConfigCache } from "./sections/Cache";
import {
  BridgeConfigGenericWebhooks,
  BridgeConfigQueue,
  BridgeGenericWebhooksConfigYAML,
  BridgeWidgetConfig,
  BridgeWidgetConfigYAML,
  BridgeConfigFeeds,
  BridgeConfigFeedsYAML,
  BridgeConfigEncryption,
  BridgeOpenProjectConfig,
  BridgeOpenProjectConfigYAML,
  BridgeConfigJira,
  BridgeConfigJiraYAML,
  BridgeConfigGitLab,
  BridgeConfigGitLabYAML,
  BridgeConfigGitHub,
  BridgeConfigGitHubYAML,
} from "./sections";
import {
  GenericHookServiceConfig,
  OpenProjectServiceConfig,
} from "../Connections";
import { ConnectionType } from "../Connections/type";

const log = new Logger("Config");

export const ValidLogLevelStrings = [
  LogLevel.ERROR.toString(),
  LogLevel.WARN.toString(),
  LogLevel.INFO.toString(),
  LogLevel.DEBUG.toString(),
  LogLevel.TRACE.toString(),
].map((l) => l.toLowerCase());

// Maps to permission_level_to_int in permissions.rs
export enum BridgePermissionLevel {
  "commands" = 1,
  login = 2,
  notifications = 3,
  manageConnections = 4,
  admin = 5,
}

export interface BridgeConfigFigma {
  publicUrl: string;
  overrideUserId?: string;
  instances: {
    [name: string]: {
      teamId: string;
      accessToken: string;
      passcode: string;
    };
  };
}

interface BridgeConfigBridge {
  domain: string;
  url: string;
  mediaUrl?: string;
  port: number;
  bindAddress: string;
}

interface BridgeConfigWebhook {
  port?: number;
  bindAddress?: string;
}

export interface BridgeConfigLogging {
  level: "debug" | "info" | "warn" | "error" | "trace";
  json?: boolean;
  colorize?: boolean;
  timestampFormat?: string;
}

interface BridgeConfigBot {
  displayname?: string;
  avatar?: string;
}

export interface BridgeConfigServiceBot {
  localpart: string;
  displayname?: string;
  avatar?: string;
  prefix: string;
  service: string;
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
  /**
   * @deprecated Old, unsupported encryption propety.
   */
  experimentalEncryption?: never;
  encryption?: BridgeConfigEncryption;
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
  openProject?: BridgeOpenProjectConfigYAML;
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
  @configKey(
    `Cache options for large scale deployments. 
    For encryption to work, this must be configured.`,
    true,
  )
  public readonly cache?: BridgeConfigCache;
  @configKey(
    `Configuration for encryption support in the bridge.
 If omitted, encryption support will be disabled.`,
    true,
  )
  public readonly encryption?: BridgeConfigEncryption;
  @configKey(
    `Message queue configuration options for large scale deployments.
 For encryption to work, this must not be configured.`,
    true,
  )
  public readonly queue?: Omit<BridgeConfigQueue, "monolithic">;
  @configKey("Logging settings. You can have a severity debug,info,warn,error")
  public readonly logging: BridgeConfigLogging;
  @configKey(
    `Permissions for using the bridge. See docs/setup.md#permissions for help`,
    true,
  )
  public readonly permissions: BridgeConfigActorPermission[];
  @configKey(`A passkey used to encrypt tokens stored inside the bridge.
 Run openssl genpkey -out passkey.pem -outform PEM -algorithm RSA -pkeyopt rsa_keygen_bits:4096 to generate`)
  public readonly passFile: string;
  @configKey("Configure this to enable GitHub support", true)
  public readonly github?: BridgeConfigGitHub;
  @configKey("Configure this to enable GitLab support", true)
  public readonly gitlab?: BridgeConfigGitLab;
  @configKey(
    "Configure this to enable Jira support. Only specify `url` if you are using a On Premise install (i.e. not atlassian.com)",
    true,
  )
  public readonly jira?: BridgeConfigJira;
  @configKey(
    `Support for generic webhook events.
'allowJsTransformationFunctions' will allow users to write short transformation snippets in code, and thus is unsafe in untrusted environments
`,
    true,
  )
  public readonly generic?: BridgeConfigGenericWebhooks;
  @configKey("Configure this to enable Figma support", true)
  public readonly figma?: BridgeConfigFigma;
  @configKey("Configure this to enable RSS/Atom feed support", true)
  public readonly feeds?: BridgeConfigFeeds;
  @configKey("Configure Challenge Hound support", true)
  public readonly challengeHound?: BridgeConfigChallengeHound;
  @configKey("Configure OpenProject support", true)
  public readonly openProject?: BridgeOpenProjectConfig;
  @configKey("Define profile information for the bot user", true)
  public readonly bot?: BridgeConfigBot;
  @configKey("Define additional bot users for specific services", true)
  public readonly serviceBots?: BridgeConfigServiceBot[];
  @configKey("EXPERIMENTAL support for complimentary widgets", true)
  public readonly widgets?: BridgeWidgetConfig;
  @configKey("Prometheus metrics support", true)
  public readonly metrics?: BridgeConfigMetrics;

  @configKey(`HTTP Listener configuration.
 Bind resource endpoints to ports and addresses.
 'port' must be specified. Each listener must listen on a unique port.
 'bindAddress' will default to '127.0.0.1' if not specified, which may not be suited to Docker environments.
 'resources' may be any of ${ResourceTypeArray.join(", ")}`)
  public readonly listeners: BridgeConfigListener[];

  @configKey("Configure Sentry error reporting", true)
  public readonly sentry?: BridgeConfigSentry;

  @hideKey()
  private readonly bridgePermissions: BridgePermissions;

  constructor(
    configData: BridgeConfigRoot,
    env?: { [key: string]: string | undefined },
  ) {
    this.logging = configData.logging || {
      level: "info",
    };
    this.bridge = configData.bridge;
    assert.ok(this.bridge);
    this.github =
      configData.github && new BridgeConfigGitHub(configData.github);
    if (this.github?.auth && env?.["GITHUB_PRIVATE_KEY_FILE"]) {
      this.github.auth.privateKeyFile = env?.["GITHUB_PRIVATE_KEY_FILE"];
    }
    if (this.github?.oauth && env?.["GITHUB_OAUTH_REDIRECT_URI"]) {
      this.github.oauth.redirect_uri = env?.["GITHUB_OAUTH_REDIRECT_URI"];
    }
    this.gitlab =
      configData.gitlab && new BridgeConfigGitLab(configData.gitlab);
    this.figma = configData.figma;
    this.jira = configData.jira && new BridgeConfigJira(configData.jira);
    this.generic =
      configData.generic && new BridgeConfigGenericWebhooks(configData.generic);
    this.feeds = configData.feeds && new BridgeConfigFeeds(configData.feeds);
    this.passFile = configData.passFile ?? "./passkey.pem";
    this.bot = configData.bot;
    this.serviceBots = configData.serviceBots;
    this.metrics = configData.metrics;
    this.challengeHound = configData.challengeHound;

    this.openProject =
      configData.openProject &&
      new BridgeOpenProjectConfig(configData.openProject);

    // TODO: Formalize env support
    if (
      env?.CFG_QUEUE_MONOLITHIC &&
      ["false", "off", "no"].includes(env.CFG_QUEUE_MONOLITHIC)
    ) {
      if (!env?.CFG_QUEUE_HOST) {
        throw new ConfigError(
          "env:CFG_QUEUE_HOST",
          "CFG_QUEUE_MONOLITHIC was defined but host was not",
        );
      }
      configData.queue = {
        monolithic: false,
        host: env?.CFG_QUEUE_HOST,
        port: env?.CFG_QUEUE_POST
          ? parseInt(env?.CFG_QUEUE_POST, 10)
          : undefined,
      };
    }

    this.cache = configData.cache;
    this.queue = configData.queue;

    if (configData.queue?.monolithic !== undefined) {
      log.warn(
        "The `queue.monolithic` config option is deprecated. Instead, configure the `cache` section.",
      );
      this.cache = {
        redisUri:
          "redisUri" in configData.queue
            ? configData.queue.redisUri
            : `redis://${configData.queue.host ?? "localhost"}:${configData.queue.port ?? 6379}`,
      };
      // If monolithic, disable the redis queue.
      if (configData.queue.monolithic === true) {
        this.queue = undefined;
      }
    }

    if (configData.experimentalEncryption) {
      throw new ConfigError(
        "experimentalEncryption",
        `This key is now called 'encryption'. Please adjust your config file.`,
      );
    }

    this.encryption =
      configData.encryption &&
      new BridgeConfigEncryption(configData.encryption, this.cache, this.queue);
    this.widgets =
      configData.widgets && new BridgeWidgetConfig(configData.widgets);
    this.sentry = configData.sentry;

    // To allow DEBUG as well as debug
    this.logging.level = this.logging.level.toLowerCase() as
      | "debug"
      | "info"
      | "warn"
      | "error"
      | "trace";
    if (!ValidLogLevelStrings.includes(this.logging.level)) {
      throw new ConfigError(
        "logging.level",
        `Logging level is not valid. Must be one of ${ValidLogLevelStrings.join(", ")}`,
      );
    }

    this.permissions = configData.permissions || [
      {
        actor: this.bridge.domain,
        services: [
          {
            service: "*",
            level: BridgePermissionLevel[BridgePermissionLevel.admin],
          },
        ],
      },
    ];
    this.bridgePermissions = new BridgePermissions(this.permissions);

    if (!configData.permissions) {
      log.warn(
        `You have not configured any permissions for the bridge, which by default means all users on ${this.bridge.domain} have admin levels of control. Please adjust your config.`,
      );
    }

    if (this.enabledServices.length === 0) {
      throw Error(
        "Config is not valid: At least one service kind must be configured",
      );
    }

    if ("goNebMigrator" in configData) {
      log.warn(
        `The GoNEB migrator has been removed from Hookshot. You should remove the 'goNebMigrator' from your config.`,
      );
    }

    if ("provisioning" in configData) {
      log.warn(
        `The provisioning API has been removed from Hookshot. You should remove the 'provisioning' from your config.`,
      );
    }

    // Listeners is a bit special
    this.listeners = configData.listeners || [];

    // For legacy reasons, copy across the per-service listener config into the listeners array.
    if (configData.webhook?.port) {
      this.listeners.push({
        resources: ["webhooks"],
        port: configData.webhook.port,
        bindAddress: configData.webhook.bindAddress,
      });
      log.warn(
        "The `webhook` configuration still specifies a port/bindAddress. This should be moved to the `listeners` config.",
      );
    }

    if (configData.widgets?.port) {
      this.listeners.push({
        resources: ["widgets"],
        port: configData.widgets.port,
      });
    }

    if (this.metrics?.port) {
      this.listeners.push({
        resources: ["metrics"],
        port: this.metrics.port,
        bindAddress: this.metrics.bindAddress,
      });
      log.warn(
        "The `metrics` configuration still specifies a port/bindAddress. This should be moved to the `listeners` config.",
      );
    }

    if (configData.widgets?.port) {
      this.listeners.push({
        resources: ["widgets"],
        port: configData.widgets.port,
      });
      log.warn(
        "The `widgets` configuration still specifies a port/bindAddress. This should be moved to the `listeners` config.",
      );
    }

    const hasWidgetListener = !!this.listeners.find((l) =>
      l.resources.includes("widgets"),
    );
    if (this.widgets && !hasWidgetListener) {
      throw new ConfigError(
        `listeners`,
        "You have enabled the widgets feature, but not included a widgets listener.",
      );
    }

    if (this.widgets && this.widgets.openIdOverrides) {
      log.warn(
        "The `widgets.openIdOverrides` config value SHOULD NOT be used in a production environment.",
      );
    }

    if (this.figma?.overrideUserId) {
      log.warn(
        "The `figma.overrideUserId` config value is deprecated. A service bot should be configured instead.",
      );
    }
  }

  public async prefillMembershipCache(client: MatrixClient) {
    const permissionRooms = this.bridgePermissions.getInterestedRooms();
    log.info(
      `Prefilling room membership for permissions for ${permissionRooms.length} rooms`,
    );
    for (const roomEntry of permissionRooms) {
      const roomId = await client.resolveRoom(roomEntry);
      // Attempt to join the room
      await client.joinRoom(roomEntry);
      const membership = await client.getJoinedRoomMembers(roomId);
      membership.forEach((userId) =>
        this.bridgePermissions.addMemberToCache(roomEntry, userId),
      );
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
    return this.bridgePermissions.checkActionAny(
      mxid,
      BridgePermissionLevel[permission],
    );
  }

  public checkPermission(
    mxid: string,
    service: string,
    permission: BridgePermissionLevel,
  ) {
    return this.bridgePermissions.checkAction(
      mxid,
      service,
      BridgePermissionLevel[permission],
    );
  }

  public get enabledServices(): ConnectionType[] {
    const services = [];
    if (this.feeds && this.feeds.enabled) {
      services.push(ConnectionType.Feeds);
    }
    if (this.figma) {
      services.push(ConnectionType.Figma);
    }
    if (this.generic) {
      if (this.generic.enabled) {
        services.push(ConnectionType.Generic);
      }
      if (this.generic.outbound) {
        services.push(ConnectionType.GenericOutbound);
      }
    }
    if (this.github) {
      services.push(ConnectionType.Github);
    }
    if (this.gitlab) {
      services.push(ConnectionType.Gitlab);
    }
    if (this.jira) {
      services.push(ConnectionType.Jira);
    }
    if (this.challengeHound) {
      services.push(ConnectionType.ChallengeHound);
    }
    if (this.openProject) {
      services.push(ConnectionType.OpenProject);
    }
    return services;
  }

  public async getPublicConfigForService(
    serviceName: ConnectionType,
  ): Promise<
    | Record<string, unknown>
    | GenericHookServiceConfig
    | OpenProjectServiceConfig
  > {
    let config:
      | undefined
      | Record<string, unknown>
      | GenericHookServiceConfig
      | OpenProjectServiceConfig;
    switch (serviceName) {
      case ConnectionType.ChallengeHound:
        config = this.challengeHound ? {} : undefined;
        break;
      case ConnectionType.Feeds:
        config = this.feeds?.publicConfig;
        break;
      case ConnectionType.Generic:
        config = await this.generic?.publicConfig;
        break;
      case ConnectionType.Github:
        config = this.github?.publicConfig();
        break;
      case ConnectionType.Gitlab:
        config = this.gitlab?.publicConfig;
        break;
      case ConnectionType.OpenProject:
        config = this.openProject?.publicConfig;
        break;
      // These services do not have public configs.
      case ConnectionType.Figma:
        config = this.figma ? {} : undefined;
        break;
      case ConnectionType.GenericOutbound:
        config = this.generic?.outbound ? {} : undefined;
        break;
      case ConnectionType.Jira:
        config = this.jira ? {} : undefined;
        break;
      default:
        throw new ApiError(
          "Not a known service, or service doesn't expose a config",
          ErrCode.NotFound,
        );
    }

    if (!config) {
      throw new ApiError("Service is not enabled", ErrCode.DisabledFeature);
    }
    return config;
  }

  static getConfigOptionsFromArgv(argv = process.argv): {
    configFiles: string[];
    registrationFile: string;
  } {
    const configFile = argv[2] || "./config.yml";
    const registrationFile = argv[3] || "./registration.yml";
    return {
      configFiles: [configFile, ...argv.slice(4)],
      registrationFile,
    };
  }

  static async parseConfig(
    filenames: string[],
    env: { [key: string]: string | undefined },
  ) {
    if (filenames.length < 1) {
      throw Error("No configuration file given");
    }
    let configurationRaw: any = {};
    // This is a shallow merge of configs.
    for (const filename of filenames) {
      configurationRaw = {
        ...configurationRaw,
        ...YAML.parse(await fs.readFile(filename, "utf-8")),
      };
    }
    log.info("Loading config from ", filenames.join(", "));
    return new BridgeConfig(configurationRaw, env);
  }
}

export async function parseRegistrationFile(filename: string) {
  const file = await fs.readFile(filename, "utf-8");
  return YAML.parse(file) as IAppserviceRegistration;
}

// Can be called directly
if (require.main === module) {
  Logger.configure({ console: "info" });
  BridgeConfig.parseConfig(
    [process.argv[2] || "config.yml", ...process.argv.slice(4)],
    process.env,
  )
    .then(() => {
      console.log("Config successfully validated.");
      process.exit(0);
    })
    .catch((ex) => {
      console.error("Error in config:", ex);
      process.exit(1);
    });
}
