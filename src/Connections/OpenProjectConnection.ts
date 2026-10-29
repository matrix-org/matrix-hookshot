import {
  Connection,
  IConnection,
  IConnectionState,
  InstantiateConnectionOpts,
  PermissionCheckFn,
  ProvisionConnectionOpts,
} from "./IConnection";
import {
  Appservice,
  Intent,
  MatrixEvent,
  RoomEvent,
  StateEvent,
} from "matrix-bot-sdk";
import { Logger } from "matrix-appservice-bridge";
import { CommandError } from "../Errors";
import {
  botCommand,
  BotCommands,
  compileBotCommands,
  HelpFunction,
} from "../BotCommands";
import {
  MatrixMessageContent,
  type MatrixEvent as CommandMatrixEvent,
} from "../MatrixEvent";
import { CommandConnection } from "./CommandConnection";
import { UserTokenStore } from "../tokens/UserTokenStore";
import { ApiError, ErrCode } from "../api";
import { OpenProjectWebhookPayloadWorkPackage } from "../openproject/Types";
import { BridgeOpenProjectConfig } from "../config/sections/OpenProject";
import { BridgeConfigMessaging } from "../config/sections";
import { IBridgeStorageProvider } from "../stores/StorageProvider";
import { TimelineManager } from "../openproject/TimelineManager";
import { OpenProjectGrantChecker } from "../openproject/GrantChecker";
import { OpenProjectEligibilityService } from "../openproject/Eligibility";
import { GetConnectionsResponseItem } from "../widgets/Api";
import { removeConnectionState } from "./BaseConnection";
import { ConnectionType } from "./type";
import type { IJsonType } from "matrix-bot-sdk/lib/helpers/Types";
import { OpenProjectTimelineCommandService } from "../openproject/TimelineCommands";
import { OpenProjectWorkPackageCommandService } from "../openproject/WorkPackageCommands";
import { OpenProjectWebhookHandler } from "../openproject/WebhookHandler";
import {
  getProjectIdFromReplyContent,
  getWorkPackageIdFromReply,
  normalizeAssignmentMention,
} from "../openproject/CommandParser";

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
  anchors: OpenProjectEventsNames[];
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
  let { events, anchors } = state as Partial<OpenProjectConnectionState>;
  events = events ?? ["work_package:created", "work_package:updated"];
  if (events.find((ev) => !JiraAllowedEvents.includes(ev))?.length) {
    throw new ApiError(
      `'events' can only contain ${JiraAllowedEvents.join(", ")}`,
      ErrCode.BadValue,
    );
  }
  anchors = anchors === undefined ? [] : anchors;
  if (
    !Array.isArray(anchors) ||
    anchors.some((event) => event !== "work_package:created")
  ) {
    throw new ApiError(
      "'anchors' can only contain work_package:created",
      ErrCode.BadValue,
    );
  }
  return { url, commandPrefix, events, anchors, priority };
}

const log = new Logger("OpenProjectConnection");

/**
 * Handles rooms connected to a Jira project.
 */
@Connection
export class OpenProjectConnection
  extends CommandConnection<OpenProjectConnectionState>
  implements IConnection
{
  public override async onMessageEvent(
    ev: CommandMatrixEvent<MatrixMessageContent>,
    checkPermission: PermissionCheckFn,
    parentEvent?: RoomEvent<IJsonType>,
  ): Promise<boolean> {
    // A project prefix selects this connection directly. A global prefix may
    // need the replied-to message to identify which project should handle it.
    const hasProjectPrefix = ev.content.body.startsWith(this.commandPrefix);
    const hasGlobalPrefix = ev.content.body.startsWith(
      `${this.defaultCommandPrefix} `,
    );
    if (!hasProjectPrefix && !hasGlobalPrefix) {
      return super.onMessageEvent(ev, checkPermission, parentEvent);
    }

    let replyEvent = parentEvent;
    const replyEventId =
      ev.content["m.relates_to"]?.["m.in_reply_to"]?.event_id;
    if (!replyEvent && replyEventId) {
      try {
        // New-style Matrix replies carry only the event ID; resolve the
        // work package message before the command parser reads its metadata.
        replyEvent = await this.as.botClient.getEvent(
          this.roomId,
          replyEventId,
        );
      } catch (ex) {
        log.warn(`Could not look up OpenProject reply ${replyEventId}`, ex);
      }
    }

    // Anchor and activity messages carry the project ID used to route a
    // global reply when several OpenProject connections share the room.
    const replyProjectId = getProjectIdFromReplyContent(replyEvent?.content);
    if (
      !hasProjectPrefix &&
      replyProjectId !== undefined &&
      replyProjectId !== this.projectId
    ) {
      // Let the connection for the replied-to project handle a global command.
      return false;
    }

    // Keep command parsing and feedback in the base class after resolving the
    // reply and replacing an Element Web mention label with its Matrix ID.
    return super.onMessageEvent(
      {
        ...ev,
        content: {
          ...ev.content,
          body: normalizeAssignmentMention(ev.content),
        },
      },
      checkPermission,
      replyEvent,
    );
  }

  protected override get helpCommandPrefix(): string {
    return `${this.defaultCommandPrefix} <projectId> `;
  }

  static readonly CanonicalEventType =
    "org.matrix.matrix-hookshot.openproject.project";

  static readonly EventTypes = [OpenProjectConnection.CanonicalEventType];
  static readonly ServiceCategory = ConnectionType.OpenProject;
  static botCommands: BotCommands;
  static helpMessage: HelpFunction;

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
    } catch {
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
    {
      as,
      intent: requestedIntent,
      tokenStore,
      config,
      storage,
      getIntegrationBotForService,
      isBotUserInRoom,
      timelineManager,
    }: ProvisionConnectionOpts,
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
    const integrationBot = getIntegrationBotForService?.(
      OpenProjectConnection.ServiceCategory,
    );
    const intent = integrationBot?.intent ?? requestedIntent;
    if (
      integrationBot &&
      isBotUserInRoom &&
      !isBotUserInRoom(roomId, integrationBot.userId)
    ) {
      throw new ApiError(
        `The selected OpenProject bot ${integrationBot.userId} is not joined to this room`,
        ErrCode.NotInRoom,
      );
    }
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
      config.messaging,
      timelineManager,
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
    await new OpenProjectGrantChecker(as, intent, tokenStore).grantConnection(
      roomId,
      {
        url: validData.url,
      },
    );
    return { connection };
  }

  static createConnectionForState(
    roomId: string,
    state: StateEvent<Record<string, unknown>>,
    {
      config,
      as,
      intent,
      tokenStore,
      storage,
      timelineManager,
    }: InstantiateConnectionOpts,
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
      config.messaging,
      timelineManager,
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
    // Removal stops timeline work before its storage cleanup can complete.
    return !this.timelineRemoved && this.projectId === project;
  }

  public readonly url: URL;
  public readonly projectId: number;
  /** The bot whose intent handles this connection's Matrix traffic. */
  public readonly botUserId: string;
  private readonly grantChecker: OpenProjectGrantChecker;
  private readonly timelineCommandService: OpenProjectTimelineCommandService;
  private readonly workPackageCommandService: OpenProjectWorkPackageCommandService;
  private readonly webhookHandler: OpenProjectWebhookHandler;
  private timelineRemoved = false;

  constructor(
    roomId: string,
    private readonly as: Appservice,
    private readonly intent: Intent,
    private readonly config: BridgeOpenProjectConfig,
    state: OpenProjectConnectionState,
    stateKey: string,
    private readonly tokenStore: UserTokenStore,
    private readonly storage: IBridgeStorageProvider,
    msgConfig: BridgeConfigMessaging,
    private readonly timelineManager = new TimelineManager(),
  ) {
    super(
      roomId,
      stateKey,
      OpenProjectConnection.CanonicalEventType,
      state,
      intent.underlyingClient,
      msgConfig,
      OpenProjectConnection.botCommands,
      OpenProjectConnection.helpMessage,
      ["openproject"],
      "!openproject",
      "openproject",
    );
    this.botUserId = intent.userId;
    this.grantChecker = new OpenProjectGrantChecker(as, intent, tokenStore);
    this.url = new URL(state.url);
    this.projectId = OpenProjectConnection.projectIdFromUrl(this.url);
    this.timelineCommandService = new OpenProjectTimelineCommandService({
      connectionId: this.connectionId,
      projectId: this.projectId,
      baseURL: this.config.baseURL,
      storage: this.storage,
      tokenStore: this.tokenStore,
      runTimelineTransition: (workPackageId, transition) =>
        this.runTimelineTransition(workPackageId, transition),
      sendEvent: (body, content, options) =>
        this.sendEvent(body, content, options),
    });
    this.workPackageCommandService = new OpenProjectWorkPackageCommandService(
      {
        projectId: this.projectId,
        baseURL: this.config.baseURL,
        tokenStore: this.tokenStore,
        interestedInProject: (projectId) => this.interestedInProject(projectId),
        getWorkPackageIDFromReply: (reply) =>
          this.getWorkPackageIDFromReply(reply),
      },
      new OpenProjectEligibilityService(tokenStore),
    );
    this.webhookHandler = new OpenProjectWebhookHandler({
      connectionId: this.connectionId,
      roomId: this.roomId,
      projectId: this.projectId,
      baseURL: this.config.baseURL,
      storage: this.storage,
      isAnchorEnabled: (eventName) => this.state.anchors.includes(eventName),
      isInterestedInHookEvent: (eventName) =>
        this.isInterestedInHookEvent(eventName),
      runTimelineTransition: (workPackageId, transition) =>
        this.runTimelineTransition(workPackageId, transition),
      sendEvent: (body, content, options) =>
        this.sendEvent(body, content, options),
    });
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

  private runTimelineTransition<T>(
    workPackageId: number,
    transition: () => Promise<T>,
  ): Promise<T | undefined> {
    if (this.timelineRemoved) {
      return Promise.resolve(undefined);
    }
    return this.timelineManager.runTransition(
      this.connectionId,
      workPackageId,
      transition,
    );
  }

  public async onWorkPackageCreated(
    data: OpenProjectWebhookPayloadWorkPackage,
  ) {
    return this.webhookHandler.onWorkPackageCreated(data);
  }

  public async onWorkPackageUpdated(
    data: OpenProjectWebhookPayloadWorkPackage,
  ) {
    return this.webhookHandler.onWorkPackageUpdated(data);
  }

  public getWorkPackageIDFromReply(
    reply?: MatrixEvent<unknown>,
  ): number | undefined {
    return getWorkPackageIdFromReply(reply, this.projectId);
  }

  /** Add the current OpenProject package as an active timeline anchor. */
  @botCommand("timeline add", {
    help: "Add a work package to the timeline",
    requiredArgs: ["workPackageId"],
    includeUserId: true,
  })
  public async commandTimelineAdd(
    userId: string,
    workPackageIdArgument: string,
  ) {
    return this.timelineCommandService.addTimelineWorkPackage(
      userId,
      workPackageIdArgument,
    );
  }

  /** Remove a work package's active anchor without changing its OpenProject status. */
  @botCommand("timeline remove", {
    help: "Remove a work package from the timeline",
    helpUsages: [
      { args: ["<workPackageId>"] },
      {
        args: [],
        note: "reply to a work package",
        prefix: "global",
      },
    ],
    includeReply: true,
    runOnGlobalPrefix: true,
  })
  public async commandTimelineRemove(
    replyOrWorkPackageId?: MatrixEvent<unknown> | string,
    workPackageIdArgument?: string,
  ) {
    const reply =
      typeof replyOrWorkPackageId === "string"
        ? undefined
        : replyOrWorkPackageId;
    const explicitWorkPackageId =
      typeof replyOrWorkPackageId === "string"
        ? replyOrWorkPackageId
        : workPackageIdArgument;
    const workPackageId =
      explicitWorkPackageId ??
      this.getWorkPackageIDFromReply(reply)?.toString();
    if (workPackageId === undefined) {
      throw new CommandError(
        "No work package ID provided",
        "Provide a work package ID or reply to a work package message.",
      );
    }
    return this.timelineCommandService.removeTimelineWorkPackage(workPackageId);
  }

  @botCommand("create", {
    help: "Create a new work package",
    requiredArgs: ["type", "subject"],
    optionalArgs: ["description"],
    includeUserId: true,
    includeReply: true,
  })
  public async commandCreateWorkPackage(
    userId: string,
    reply: MatrixEvent<unknown> | undefined,
    type: string,
    subject: string,
    cmdDescription?: string,
  ) {
    return this.workPackageCommandService.createWorkPackage(
      userId,
      reply,
      type,
      subject,
      cmdDescription,
    );
  }

  @botCommand("close", {
    help: "Close a work package",
    helpUsages: [
      { args: ["<workPackageId>", "[description]"] },
      {
        args: ["[description]"],
        note: "reply to a work package",
        prefix: "global",
      },
    ],
    includeUserId: true,
    includeReply: true,
    // We allow uses to call global for shorthand replies.
    runOnGlobalPrefix: true,
  })
  public async commandCloseWorkPackage(
    userId: string,
    reply: MatrixEvent<unknown> | undefined,
    workPackageIdOrComment?: string,
    comment?: string,
  ) {
    return this.workPackageCommandService.closeWorkPackage(
      userId,
      reply,
      workPackageIdOrComment,
      comment,
    );
  }

  @botCommand("priority", {
    help: "Set the priority for a work package",
    helpUsages: [
      { args: ["<workPackageId>", "<priority>"] },
      {
        args: ["<priority>"],
        note: "reply to a work package",
        prefix: "global",
      },
    ],
    includeUserId: true,
    includeReply: true,
    // We allow uses to call global for shorthand replies.
    runOnGlobalPrefix: true,
  })
  public async commandSetPriority(
    userId: string,
    reply: MatrixEvent<unknown> | undefined,
    workPackageIdOrPriority?: string,
    priority?: string,
  ) {
    return this.workPackageCommandService.setPriority(
      userId,
      reply,
      workPackageIdOrPriority,
      priority,
    );
  }

  @botCommand("assign", {
    help: "Assign a work package to a new user (use 'unset' to remove)",
    helpUsages: [
      { args: ["<workPackageId>", "[user]"] },
      {
        args: ["[user]"],
        note: "reply to a work package",
        prefix: "global",
      },
    ],
    includeUserId: true,
    includeReply: true,
    // We allow uses to call global for shorthand replies.
    runOnGlobalPrefix: true,
  })
  public async commandAssignWorkPackage(
    userId: string,
    reply: MatrixEvent<unknown> | undefined,
    workPackageIdOrAssignee?: string,
    cliAssignee?: string,
    ...additionalAssigneeParts: string[]
  ) {
    return this.workPackageCommandService.changeWorkPackageUser(
      "assignee",
      userId,
      reply,
      workPackageIdOrAssignee,
      cliAssignee,
      ...additionalAssigneeParts,
    );
  }

  @botCommand("responsible", {
    help: "Assign a responsible user to a work package (use 'unset' to remove)",
    helpUsages: [
      { args: ["<workPackageId>", "[user]"] },
      {
        args: ["[user]"],
        note: "reply to a work package",
        prefix: "global",
      },
    ],
    includeUserId: true,
    includeReply: true,
    // We allow uses to call global for shorthand replies.
    runOnGlobalPrefix: true,
  })
  public async commandResponsibleWorkPackage(
    userId: string,
    reply: MatrixEvent<unknown> | undefined,
    workPackageIdOrAssignee?: string,
    cliAssignee?: string,
    ...additionalAssigneeParts: string[]
  ) {
    return this.workPackageCommandService.changeWorkPackageUser(
      "responsible",
      userId,
      reply,
      workPackageIdOrAssignee,
      cliAssignee,
      ...additionalAssigneeParts,
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

  /** Delete this connection's anchors and activity snapshots after transitions. */
  public async cleanupTimelineState(): Promise<void> {
    this.timelineRemoved = true;
    await this.timelineManager.runConnectionTransition(
      this.connectionId,
      async () => {
        await Promise.all([
          this.storage.deleteOpenProjectAnchorStates(this.connectionId),
          this.storage.deleteOpenProjectActivityStates(this.connectionId),
        ]);
      },
    );
  }

  public async onRemove() {
    log.info(`Removing ${this.toString()} for ${this.roomId}`);
    const wasTimelineRemoved = this.timelineRemoved;
    this.timelineRemoved = true;
    try {
      // Keep the active anchors and grant if Matrix cannot disable the connection.
      await removeConnectionState(
        this.intent.underlyingClient,
        this.roomId,
        this.stateKey,
        OpenProjectConnection,
      );
    } catch (error) {
      this.timelineRemoved = wasTimelineRemoved;
      throw error;
    }
    await this.cleanupTimelineState();
    await this.grantChecker.ungrantConnection(this.roomId, {
      url: this.state.url,
    });
  }

  public async migrateToNewRoom(newRoomId: string): Promise<void> {
    await this.grantChecker.grantConnection(this.roomId, {
      url: this.state.url,
    });
    // Copy across state
    await this.intent.underlyingClient.sendStateEvent(
      newRoomId,
      OpenProjectConnection.CanonicalEventType,
      this.stateKey,
      this.state,
    );
    // And finally, delete this connection
    await this.onRemove();
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
