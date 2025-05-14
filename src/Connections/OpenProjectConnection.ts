import {
  Connection,
  IConnection,
  IConnectionState,
  InstantiateConnectionOpts,
  ProvisionConnectionOpts,
} from "./IConnection";
import { Appservice, Intent, StateEvent } from "matrix-bot-sdk";
import { Logger } from "matrix-appservice-bridge";
import markdownit from "markdown-it";
import { BotCommands, compileBotCommands } from "../BotCommands";
import { MatrixMessageContent } from "../MatrixEvent";
import { CommandConnection } from "./CommandConnection";
import { UserTokenStore } from "../tokens/UserTokenStore";
import { ApiError, ErrCode } from "../api";
import { OpenProjectWebhookPayloadWorkPackage } from "../openproject/types";
import { BridgeOpenProjectConfig } from "../config/sections/OpenProject";
import {
  formatWorkPackageDiff,
  formatWorkPackageForMatrix,
} from "../openproject/format";
import { IBridgeStorageProvider } from "../stores/StorageProvider";
import { workPackageToCacheState } from "../openproject/state";
import { OpenProjectGrantChecker } from "../openproject/GrantChecker";
import { GetConnectionsResponseItem } from "../widgets/Api";

export type OpenProjectEventsNames =
  | "work_package:created"
  | "work_package:updated"
  | "work_package:assignee_changed"
  | "work_package:description_changed"
  | "work_package:duedate_changed"
  | "work_package:workpercent_changed"
  | "work_package:priority_changed"
  | "work_package:responsible_changed"
  | "work_package:subject_changed";

const JiraAllowedEvents: OpenProjectEventsNames[] = [
  "work_package:created",
  "work_package:updated",
  "work_package:assignee_changed",
  "work_package:description_changed",
  "work_package:duedate_changed",
  "work_package:workpercent_changed",
  "work_package:priority_changed",
  "work_package:responsible_changed",
  "work_package:subject_changed",
];

export interface OpenProjectConnectionState extends IConnectionState {
  /**
   * We use URL here as it's more ergonomic for users to paste, and it preserves
   * the origin of the project too for future enhancement.
   */
  url: string;
  events: OpenProjectEventsNames[];
}

export type OpenProjectResponseItem =
  GetConnectionsResponseItem<OpenProjectConnectionState>;

export interface OpenProjectConnectionRepoTarget {
  name: string;
  description: string;
  id: number;
  url: string;
  suggested_prefix: string;
}

export interface OpenProjectConnectionFilters {
  search?: string;
}

export interface OpenProjectServiceConfig {
  baseUrl: string;
}

function validateOpenProjectConnectionState(
  state: unknown,
  baseUrl: URL,
): OpenProjectConnectionState {
  const { url, commandPrefix, priority } =
    state as Partial<OpenProjectConnectionState>;
  if (url === undefined || typeof url !== "string") {
    throw new ApiError("Expected 'url' to be a string", ErrCode.BadValue);
  }
  if (!URL.canParse(url)) {
    throw new ApiError("Expected 'url' to be a URL", ErrCode.BadValue);
  }
  const parsedUrl = new URL(url);
  if (parsedUrl.origin !== baseUrl.origin) {
    throw new ApiError(
      `Expected 'url' to match the origin '${baseUrl.origin}'`,
      ErrCode.BadValue,
    );
  }
  // Validate the URL
  OpenProjectConnection.projectIdFromUrl(parsedUrl);
  if (commandPrefix) {
    if (typeof commandPrefix !== "string") {
      throw new ApiError(
        "Expected 'commandPrefix' to be a string",
        ErrCode.BadValue,
      );
    }
    // Higher limit because project names can be long
    if (commandPrefix.length < 2 || commandPrefix.length > 48) {
      throw new ApiError(
        "Expected 'commandPrefix' to be between 2-48 characters",
        ErrCode.BadValue,
      );
    }
  }
  let { events } = state as Partial<OpenProjectConnectionState>;
  events = events ?? ["work_package:created", "work_package:updated"];
  if (events.find((ev) => !JiraAllowedEvents.includes(ev))?.length) {
    throw new ApiError(
      `'events' can only contain ${JiraAllowedEvents.join(", ")}`,
      ErrCode.BadValue,
    );
  }
  return { url, commandPrefix, events, priority };
}

const log = new Logger("OpenProjectConnection");
const md = new markdownit();

/**
 * Handles rooms connected to a Jira project.
 */
@Connection
export class OpenProjectConnection
  extends CommandConnection<OpenProjectConnectionState>
  implements IConnection
{
  static readonly CanonicalEventType =
    "org.matrix.matrix-hookshot.openproject.project";

  static readonly EventTypes = [OpenProjectConnection.CanonicalEventType];
  static readonly ServiceCategory = "openproject";
  static botCommands: BotCommands;
  static helpMessage: (cmdPrefix?: string) => MatrixMessageContent;

  static projectIdFromUrl(url: URL): number {
    const id = parseInt(/\/projects\/(\d+)\/?/.exec(url.pathname)?.[1] ?? "");
    if (isNaN(id)) {
      throw Error("URL for project doesnt contain a project ID");
    }
    return id;
  }

  static async assertUserHasAccessToProject(
    tokenStore: UserTokenStore,
    userId: string,
    urlStr: string,
  ) {
    const url = new URL(urlStr);
    const client = await tokenStore.getOpenProjectForUser(userId);
    if (!client) {
      throw new ApiError(
        "User is not authenticated with OpenProject",
        ErrCode.ForbiddenUser,
      );
    }
    const projectId = OpenProjectConnection.projectIdFromUrl(url);
    if (!projectId) {
      throw new ApiError(
        "URL did not contain a valid project id",
        ErrCode.BadValue,
      );
    }
    try {
      // Need to check that the user can access this.
      const project = await client.getProject(projectId);
      return project;
    } catch (ex) {
      throw new ApiError(
        "Requested project was not found",
        ErrCode.ForbiddenUser,
      );
    }
  }

  static async provisionConnection(
    roomId: string,
    userId: string,
    data: Record<string, unknown>,
    { as, intent, tokenStore, config, storage }: ProvisionConnectionOpts,
  ) {
    if (!config.openProject) {
      throw new ApiError(
        "OpenProject integration is not configured",
        ErrCode.DisabledFeature,
      );
    }
    const validData = validateOpenProjectConnectionState(
      data,
      config.openProject.baseURL,
    );
    log.info(
      `Attempting to provisionConnection for ${roomId} ${validData.url} on behalf of ${userId}`,
    );
    await this.assertUserHasAccessToProject(tokenStore, userId, validData.url);
    const connection = new OpenProjectConnection(
      roomId,
      as,
      intent,
      config.openProject,
      validData,
      validData.url,
      tokenStore,
      storage,
    );
    await intent.underlyingClient.sendStateEvent(
      roomId,
      OpenProjectConnection.CanonicalEventType,
      connection.stateKey,
      validData,
    );
    log.info(
      `Created connection via provisionConnection ${connection.toString()}`,
    );
    await new OpenProjectGrantChecker(as, tokenStore).grantConnection(roomId, {
      url: validData.url,
    });
    return { connection };
  }

  static createConnectionForState(
    roomId: string,
    state: StateEvent<Record<string, unknown>>,
    { config, as, intent, tokenStore, storage }: InstantiateConnectionOpts,
  ) {
    if (!config.openProject) {
      throw Error("OpenProject is not configured");
    }
    const connectionConfig = validateOpenProjectConnectionState(
      state.content,
      config.openProject.baseURL,
    );
    return new OpenProjectConnection(
      roomId,
      as,
      intent,
      config.openProject,
      connectionConfig,
      state.stateKey,
      tokenStore,
      storage,
    );
  }

  public static async getConnectionTargets(
    userId: string,
    tokenStore: UserTokenStore,
    filters: OpenProjectConnectionFilters = {},
  ): Promise<OpenProjectConnectionRepoTarget[]> {
    // Search for all repos under the user's control.
    const client = await tokenStore.getOpenProjectForUser(userId);
    if (!client) {
      throw new ApiError(
        "User is not authenticated with OpenProject",
        ErrCode.ForbiddenUser,
      );
    }

    const projects = await client.searchProjects(filters.search);
    return projects.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description.raw,
      url: p.project_url,
      suggested_prefix: `!openproject ${p.identifier}`,
    }));
  }
  public get priority(): number {
    return this.state.priority || super.priority;
  }

  public toString() {
    return `OpenProjectConnection ${this.projectId}`;
  }

  public isInterestedInHookEvent(
    eventName: OpenProjectEventsNames,
    interestedByDefault = false,
  ) {
    return !this.state.events
      ? interestedByDefault
      : this.state.events.includes(eventName);
  }

  public interestedInProject(project: number) {
    if (this.projectId === project) {
      return true;
    }
    return false;
  }

  public readonly url: URL;
  public readonly projectId: number;
  private readonly grantChecker: OpenProjectGrantChecker;

  constructor(
    roomId: string,
    private readonly as: Appservice,
    private readonly intent: Intent,
    private readonly config: BridgeOpenProjectConfig,
    state: OpenProjectConnectionState,
    stateKey: string,
    private readonly tokenStore: UserTokenStore,
    private readonly storage: IBridgeStorageProvider,
  ) {
    super(
      roomId,
      stateKey,
      OpenProjectConnection.CanonicalEventType,
      state,
      intent.underlyingClient,
      OpenProjectConnection.botCommands,
      OpenProjectConnection.helpMessage,
      ["openproject"],
      "!openproject",
      "openproject",
    );
    this.grantChecker = new OpenProjectGrantChecker(as, tokenStore);
    this.url = new URL(state.url);
    this.projectId = OpenProjectConnection.projectIdFromUrl(this.url);
  }

  public isInterestedInStateEvent(eventType: string, stateKey: string) {
    return (
      OpenProjectConnection.EventTypes.includes(eventType) &&
      this.stateKey === stateKey
    );
  }

  protected validateConnectionState(content: unknown) {
    return validateOpenProjectConnectionState(content, this.config.baseURL);
  }

  public ensureGrant(sender?: string) {
    return this.grantChecker.assertConnectionGranted(
      this.roomId,
      {
        url: this.state.url,
      },
      sender,
    );
  }

  public async onWorkPackageCreated(
    data: OpenProjectWebhookPayloadWorkPackage,
  ) {
    if (!this.isInterestedInHookEvent("work_package:created")) {
      return;
    }
    log.info(
      `onWorkPackageCreated ${this.roomId} ${this.projectId} ${data.work_package.id}`,
    );

    const creator = data.work_package._embedded.author;
    if (!creator) {
      throw Error("No creator field");
    }
    const extraData = formatWorkPackageForMatrix(
      data.work_package,
      this.config.baseURL,
    );
    const content = `${creator.name} created a new work package [${data.work_package.id}](${extraData["org.matrix.matrix-hookshot.openproject.work_package"].url}): "${data.work_package.subject}"`;
    await this.intent.sendEvent(this.roomId, {
      msgtype: "m.notice",
      body: content,
      formatted_body: md.renderInline(content),
      format: "org.matrix.custom.html",
      ...formatWorkPackageForMatrix(data.work_package, this.config.baseURL),
    });
    await this.storage.setOpenProjectWorkPackageState(
      workPackageToCacheState(data.work_package),
      data.work_package.id,
    );
  }

  public async onWorkPackageUpdated(
    data: OpenProjectWebhookPayloadWorkPackage,
  ) {
    log.info(
      `onWorkPackageUpdated ${this.roomId} ${this.projectId} ${data.work_package.id}`,
    );

    const creator = data.work_package._embedded.author;
    if (!creator) {
      throw Error("No creator field");
    }
    const extraData = formatWorkPackageForMatrix(
      data.work_package,
      this.config.baseURL,
    );
    const oldChanges = await this.storage.getOpenProjectWorkPackageState(
      data.work_package._embedded.project.id,
      data.work_package.id,
    );

    // Detect what changed.
    let changeStatement = "updated work package";
    let postfix;
    let hookEvent: OpenProjectEventsNames = "work_package:updated";
    if (oldChanges) {
      const diffSet = formatWorkPackageDiff(oldChanges, data.work_package);
      if (diffSet) {
        hookEvent = diffSet.eventKind;
        postfix = diffSet.postfix;
        if (diffSet.changes.length === 1) {
          changeStatement = diffSet.changes[0];
        } else {
          postfix = `  - ${diffSet.changes.join("\n  - ")}`;
        }
      } else {
        // Changes were not understood, skip.
        return;
      }
    }
    if (!this.isInterestedInHookEvent(hookEvent ?? "work_package:updated")) {
      return;
    }
    const content = `**${creator.name}** ${changeStatement} for [${data.work_package.id}](${extraData["org.matrix.matrix-hookshot.openproject.work_package"].url}): "${data.work_package.subject}"`;

    await this.intent.sendEvent(this.roomId, {
      msgtype: "m.notice",
      body: content + (postfix ? postfix : ""),
      formatted_body:
        md.renderInline(content) + (postfix ? md.render(postfix) : ""),
      format: "org.matrix.custom.html",
      ...formatWorkPackageForMatrix(data.work_package, this.config.baseURL),
    });
    await this.storage.setOpenProjectWorkPackageState(
      workPackageToCacheState(data.work_package),
      data.work_package.id,
    );
  }

  public static getProvisionerDetails(botUserId: string) {
    return {
      service: "openproject",
      eventType: OpenProjectConnection.CanonicalEventType,
      type: "OpenProject",
      botUserId: botUserId,
    };
  }

  public getProvisionerDetails(): OpenProjectResponseItem {
    return {
      ...OpenProjectConnection.getProvisionerDetails(this.intent.userId),
      id: this.connectionId,
      config: {
        ...this.state,
      },
    };
  }

  public async onRemove() {
    log.info(`Removing ${this.toString()} for ${this.roomId}`);
    await this.grantChecker.ungrantConnection(this.roomId, {
      url: this.state.url,
    });
    // Do a sanity check that the event exists.
    await this.intent.underlyingClient.getRoomStateEvent(
      this.roomId,
      OpenProjectConnection.CanonicalEventType,
      this.stateKey,
    );
    await this.intent.underlyingClient.sendStateEvent(
      this.roomId,
      OpenProjectConnection.CanonicalEventType,
      this.stateKey,
      { disabled: true },
    );
  }

  public async provisionerUpdateConfig(
    userId: string,
    config: Record<string, unknown>,
  ) {
    // Apply previous state to the current config, as provisioners might not return "unknown" keys.
    config = { ...this.state, ...config };
    const validatedConfig = validateOpenProjectConnectionState(
      config,
      this.config.baseURL,
    );
    if (this.state.url !== validatedConfig.url) {
      throw new ApiError(
        "Project URL cannot be changed. Create a new connection instead.",
        ErrCode.UnsupportedOperation,
      );
    }
    await this.intent.underlyingClient.sendStateEvent(
      this.roomId,
      OpenProjectConnection.CanonicalEventType,
      this.stateKey,
      validatedConfig,
    );
    this.state = validatedConfig;
  }
}

 
const res = compileBotCommands(
  OpenProjectConnection.prototype as any,
  CommandConnection.prototype as any,
);
OpenProjectConnection.helpMessage = res.helpMessage;
OpenProjectConnection.botCommands = res.botCommands;
