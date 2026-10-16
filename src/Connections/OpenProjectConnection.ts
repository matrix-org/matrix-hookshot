import { randomUUID } from "node:crypto";
import {
  Connection,
  IConnection,
  IConnectionState,
  InstantiateConnectionOpts,
  ProvisionConnectionOpts,
} from "./IConnection";
import {
  Appservice,
  Intent,
  MatrixError,
  MatrixEvent,
  MessageEventContent,
  StateEvent,
  UserID,
} from "matrix-bot-sdk";
import { Logger } from "matrix-appservice-bridge";
import { botCommand, BotCommands, compileBotCommands } from "../BotCommands";
import { MatrixMessageContent } from "../MatrixEvent";
import { CommandConnection } from "./CommandConnection";
import { UserTokenStore } from "../tokens/UserTokenStore";
import { ApiError, ErrCode } from "../api";
import { OpenProjectWebhookPayloadWorkPackage } from "../openproject/Types";
import { BridgeOpenProjectConfig } from "../config/sections/OpenProject";
import { BridgeConfigMessaging } from "../config/sections";
import {
  formatWorkPackageAnchorContent,
  formatInactiveWorkPackageAnchorReplacement,
  formatWorkPackageAnchorReplacement,
  formatWorkPackageActivityForMatrix,
  formatWorkPackageDiff,
  OpenProjectWorkPackageMatrixEvent,
} from "../openproject/Format";
import { IBridgeStorageProvider } from "../stores/StorageProvider";
import { workPackageToCacheState } from "../openproject/State";
import { TimelineManager } from "../openproject/TimelineManager";
import { OpenProjectGrantChecker } from "../openproject/GrantChecker";
import { GetConnectionsResponseItem } from "../widgets/Api";
import { CommandError, NotLoggedInError } from "../Errors";
import { removeConnectionState } from "./BaseConnection";
import { ConnectionType } from "./type";
import {
  OPENPROJECT_ANCHOR_EVENT_KIND,
  OPENPROJECT_ANCHOR_STATE_ACTIVE,
  OPENPROJECT_EVENT_SCHEMA_VERSION,
} from "../openproject/Schema";
import type { OpenProjectAnchorState } from "../openproject/State";

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

function isMissingAnchorError(error: unknown): error is MatrixError {
  return error instanceof MatrixError && error.errcode === "M_NOT_FOUND";
}

function parseWorkPackageId(argument: string): number {
  if (!/^\d+$/.test(argument)) {
    throw new CommandError(
      "Invalid work package ID",
      "Work package ID must be a positive safe integer.",
    );
  }
  const workPackageId = Number(argument);
  if (!Number.isSafeInteger(workPackageId) || workPackageId <= 0) {
    throw new CommandError(
      "Invalid work package ID",
      "Work package ID must be a positive safe integer.",
    );
  }
  return workPackageId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidAnchorStateForRemoval(
  value: unknown,
  workPackageId: number,
): value is OpenProjectAnchorState {
  if (!isRecord(value) || !isRecord(value.lastContent)) {
    return false;
  }

  const content = value.lastContent;
  const workPackage =
    content["org.matrix.matrix-hookshot.openproject.work_package"];
  // The snapshot is written by our formatter. Removal only reads these fields;
  // leave optional display data untouched so API nulls do not block removal.
  return (
    typeof value.anchorEventId === "string" &&
    value.anchorEventId.length > 0 &&
    typeof value.lockVersion === "number" &&
    Number.isSafeInteger(value.lockVersion) &&
    value.lockVersion >= 0 &&
    content.msgtype === "m.notice" &&
    typeof content.body === "string" &&
    content["org.matrix.matrix-hookshot.openproject.schema_version"] ===
      OPENPROJECT_EVENT_SCHEMA_VERSION &&
    content["org.matrix.matrix-hookshot.openproject.event_kind"] ===
      OPENPROJECT_ANCHOR_EVENT_KIND &&
    content["org.matrix.matrix-hookshot.openproject.anchor_state"] ===
      OPENPROJECT_ANCHOR_STATE_ACTIVE &&
    typeof content["org.matrix.matrix-hookshot.openproject.snapshot_id"] ===
      "string" &&
    isRecord(workPackage) &&
    workPackage.id === workPackageId &&
    typeof workPackage.subject === "string" &&
    typeof workPackage.url === "string"
  );
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
  static readonly CanonicalEventType =
    "org.matrix.matrix-hookshot.openproject.project";

  static readonly EventTypes = [OpenProjectConnection.CanonicalEventType];
  static readonly ServiceCategory = ConnectionType.OpenProject;
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
    const workPackage = data.work_package;
    await this.runTimelineTransition(workPackage.id, async () => {
      try {
        log.info(
          `onWorkPackageCreated ${this.roomId} ${this.projectId} ${workPackage.id}`,
        );

        const existing = await this.storage.getOpenProjectAnchorState(
          this.connectionId,
          workPackage.id,
        );
        if (!existing && this.state.anchors.includes("work_package:created")) {
          const content = formatWorkPackageAnchorContent(
            workPackage,
            this.config.baseURL,
            { snapshotId: randomUUID() },
          );
          const anchorEventId = await this.sendEvent(content.body, content, {
            inline: false,
          });
          await this.storage.setOpenProjectAnchorState(
            this.connectionId,
            workPackage.id,
            {
              anchorEventId,
              lockVersion: workPackage.lockVersion,
              lastContent: content,
            },
          );
        } else if (existing && workPackage.lockVersion > existing.lockVersion) {
          const replacement = formatWorkPackageAnchorReplacement(
            existing.anchorEventId,
            workPackage,
            this.config.baseURL,
            { snapshotId: randomUUID() },
          );
          await this.sendEvent(replacement.body, replacement, {
            inline: false,
          });
          await this.storage.setOpenProjectAnchorState(
            this.connectionId,
            workPackage.id,
            {
              anchorEventId: existing.anchorEventId,
              lockVersion: workPackage.lockVersion,
              lastContent: replacement["m.new_content"],
            },
          );
        }
      } catch (error) {
        log.warn(
          `Failed to update OpenProject anchor for ${this.connectionId}/${workPackage.id}; Activity processing will continue`,
          error,
        );
      }

      try {
        await this.processWorkPackageActivity(data, true);
      } catch (error) {
        log.warn(
          `Failed to process OpenProject Activity for ${this.connectionId}/${workPackage.id}`,
          error,
        );
      }
    });
  }

  public async onWorkPackageUpdated(
    data: OpenProjectWebhookPayloadWorkPackage,
  ) {
    const workPackage = data.work_package;
    log.info(
      `onWorkPackageUpdated ${this.roomId} ${this.projectId} ${workPackage.id}`,
    );

    await this.runTimelineTransition(workPackage.id, async () => {
      try {
        const activeAnchor = await this.storage.getOpenProjectAnchorState(
          this.connectionId,
          workPackage.id,
        );
        if (
          activeAnchor &&
          workPackage.lockVersion > activeAnchor.lockVersion
        ) {
          const replacement = formatWorkPackageAnchorReplacement(
            activeAnchor.anchorEventId,
            workPackage,
            this.config.baseURL,
            { snapshotId: randomUUID() },
          );
          let missingAnchor = false;
          try {
            await this.sendEvent(replacement.body, replacement, {
              inline: false,
            });
          } catch (error) {
            if (!isMissingAnchorError(error)) {
              throw error;
            }
            missingAnchor = true;
            await this.storage.deleteOpenProjectAnchorState(
              this.connectionId,
              workPackage.id,
            );
            log.info(
              `Removing missing OpenProject anchor ${activeAnchor.anchorEventId} for ${this.connectionId}/${workPackage.id}`,
            );
          }
          if (!missingAnchor) {
            await this.storage.setOpenProjectAnchorState(
              this.connectionId,
              workPackage.id,
              {
                anchorEventId: activeAnchor.anchorEventId,
                lockVersion: workPackage.lockVersion,
                lastContent: replacement["m.new_content"],
              },
            );
          }
        }
      } catch (error) {
        log.warn(
          `Failed to update OpenProject anchor for ${this.connectionId}/${workPackage.id}; Activity processing will continue`,
          error,
        );
      }

      try {
        await this.processWorkPackageActivity(data, false);
      } catch (error) {
        log.warn(
          `Failed to process OpenProject Activity for ${this.connectionId}/${workPackage.id}`,
          error,
        );
      }
    });
  }

  /** Advance this room's Activity cursor and send at most one event per revision. */
  private async processWorkPackageActivity(
    data: OpenProjectWebhookPayloadWorkPackage,
    created: boolean,
  ): Promise<void> {
    const workPackage = data.work_package;
    const previous = await this.storage.getOpenProjectActivityState(
      this.connectionId,
      workPackage.id,
    );
    if (previous && workPackage.lockVersion <= previous.lockVersion) {
      return;
    }

    const diff =
      previous && !created
        ? formatWorkPackageDiff(previous, workPackage)
        : null;
    const changes = created
      ? ["created the work package"]
      : previous
        ? (diff?.changes ?? [])
        : ["updated the work package"];
    const shouldSend = created
      ? this.isInterestedInHookEvent("work_package:created")
      : previous
        ? !!diff &&
          (this.isInterestedInHookEvent("work_package:updated") ||
            diff.categories.some((category) =>
              this.isInterestedInHookEvent(category),
            ))
        : this.isInterestedInHookEvent("work_package:updated");

    if (shouldSend) {
      const activeAnchor = await this.storage.getOpenProjectAnchorState(
        this.connectionId,
        workPackage.id,
      );
      const content = formatWorkPackageActivityForMatrix(
        workPackage,
        this.config.baseURL,
        changes,
        {
          actor: data.actor,
          created,
          anchorEventId: activeAnchor?.anchorEventId,
        },
      );
      await this.sendEvent(content.body, content, { inline: false });
    }

    await this.storage.setOpenProjectActivityState(
      this.connectionId,
      workPackage.id,
      workPackageToCacheState(workPackage),
    );
  }

  public getWorkPackageIDFromReply(
    reply?: MatrixEvent<unknown>,
  ): number | undefined {
    if (!reply) {
      return undefined;
    }
    const replyContent = reply?.content as OpenProjectWorkPackageMatrixEvent;
    if (
      reply.type !== "m.room.message" ||
      !replyContent["org.matrix.matrix-hookshot.openproject.project"]?.id ||
      !replyContent["org.matrix.matrix-hookshot.openproject.work_package"]?.id
    ) {
      throw new CommandError(
        "Did not reference a hookshot event",
        "You must reply to a work package message when running this command.",
      );
    }
    if (
      replyContent["org.matrix.matrix-hookshot.openproject.project"].id !==
      this.projectId
    ) {
      // This is not us.
      return;
    }
    return replyContent["org.matrix.matrix-hookshot.openproject.work_package"]
      .id;
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
    const workPackageId = parseWorkPackageId(workPackageIdArgument);

    const client = await this.tokenStore.getOpenProjectForUser(userId);
    if (!client) {
      throw new NotLoggedInError();
    }
    const workPackage = await client.getWorkPackage(workPackageId);
    if (workPackage._embedded.project.id !== this.projectId) {
      throw new CommandError(
        "Work package belongs to another project",
        "This work package is not part of the project configured for this connection.",
      );
    }

    await this.runTimelineTransition(workPackage.id, async () => {
      const activeAnchor = await this.storage.getOpenProjectAnchorState(
        this.connectionId,
        workPackage.id,
      );
      if (activeAnchor) {
        return;
      }

      const content = formatWorkPackageAnchorContent(
        workPackage,
        this.config.baseURL,
        { snapshotId: randomUUID() },
      );
      const anchorEventId = await this.sendEvent(content.body, content, {
        inline: false,
      });
      await this.storage.setOpenProjectAnchorState(
        this.connectionId,
        workPackage.id,
        {
          anchorEventId,
          lockVersion: workPackage.lockVersion,
          lastContent: content,
        },
      );
    });
  }

  /** Remove a work package's active anchor without changing its OpenProject status. */
  @botCommand("timeline remove", {
    help: "Remove a work package from the timeline",
    requiredArgs: ["workPackageId"],
  })
  public async commandTimelineRemove(workPackageIdArgument: string) {
    const workPackageId = parseWorkPackageId(workPackageIdArgument);
    await this.runTimelineTransition(workPackageId, async () => {
      const activeAnchor = await this.storage.getOpenProjectAnchorState(
        this.connectionId,
        workPackageId,
      );
      if (!activeAnchor) {
        return;
      }
      if (!isValidAnchorStateForRemoval(activeAnchor, workPackageId)) {
        throw new CommandError(
          "Invalid stored timeline anchor",
          "The stored timeline anchor is invalid and cannot be removed safely.",
        );
      }

      const replacement = formatInactiveWorkPackageAnchorReplacement(
        activeAnchor.anchorEventId,
        activeAnchor.lastContent,
        randomUUID(),
      );
      await this.sendEvent(replacement.body, replacement, {
        inline: false,
      });
      await this.storage.deleteOpenProjectAnchorState(
        this.connectionId,
        workPackageId,
      );
    });
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
    const client = await this.tokenStore.getOpenProjectForUser(userId);
    if (!client) {
      throw new NotLoggedInError();
    }
    let finalDescription: string | undefined;
    if (reply) {
      if (reply.type !== "m.room.message") {
        throw new CommandError(
          "Reply was not a m.room.message",
          "You can only use textual events as work package descriptions.",
        );
      }
      const replyContent = reply.content as MessageEventContent;
      if (!replyContent.body?.trim()) {
        throw new CommandError(
          "Source message had no body",
          "This event has no content and cannot be used.",
        );
      }
      if (cmdDescription) {
        finalDescription = `${cmdDescription}\n\n${replyContent.body}`;
      } else {
        finalDescription = replyContent.body;
      }
    } else {
      finalDescription = cmdDescription;
    }
    const allTypes = await client.getTypesInProject(this.projectId);
    const foundType = allTypes.find(
      (t) => t.name.toLowerCase() === type.toLowerCase(),
    );
    if (!foundType) {
      throw new CommandError(
        "Type not understood",
        `Work package type not known. You can use ${allTypes.map((t) => (t.name.includes(" ") ? `"${t.name}"` : t.name)).join(", ")}`,
      );
    }
    await client.createWorkPackage(
      this.projectId,
      foundType,
      subject,
      finalDescription,
    );
  }

  @botCommand("close", {
    help: "Close a work package",
    optionalArgs: ["workPackageId", "description"],
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
    const client = await this.tokenStore.getOpenProjectForUser(userId);
    if (!client) {
      throw new NotLoggedInError();
    }
    let finalComment: string | undefined;
    let workPackageId;
    const replyWp = this.getWorkPackageIDFromReply(reply);
    if (replyWp) {
      workPackageId = replyWp;
      finalComment = workPackageIdOrComment;
    } else if (workPackageIdOrComment) {
      workPackageId = parseInt(workPackageIdOrComment);
      finalComment = comment;
    } else {
      throw new CommandError(
        "No ID provided",
        "You must provide a work package ID",
      );
    }
    if (isNaN(workPackageId)) {
      throw new CommandError(
        "Invalid work package ID",
        "Work Package ID must be a valid number",
      );
    }

    // TODO: Cache this.
    const validStatuses = await client.getStatuses();
    // Prefer the "closed" status, but if that fails then we'll just use whatever status is used for closed.
    const closedStatus =
      validStatuses.find((s) => s.name.toLowerCase() === "closed") ??
      validStatuses.find((s) => s.isClosed);

    if (!closedStatus) {
      throw new CommandError(
        "No closed status on OpenProject",
        "This instance doesn't have a closed status, so the work package cannot be closed.",
      );
    }

    await client.updateWorkPackage(workPackageId, {
      _links: {
        status: {
          href: closedStatus?._links.self.href,
        },
      },
    });
    if (finalComment) {
      await client.addWorkPackageComment(workPackageId, finalComment);
    }
  }

  @botCommand("priority", {
    help: "Set the priority for a work package",
    optionalArgs: ["workPackageId", "priority"],
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
    const client = await this.tokenStore.getOpenProjectForUser(userId);
    if (!client) {
      throw new NotLoggedInError();
    }
    let finalPriority: string | undefined;
    let workPackageId;
    const replyWp = this.getWorkPackageIDFromReply(reply);
    if (replyWp) {
      workPackageId = replyWp;
      finalPriority = workPackageIdOrPriority;
    } else if (workPackageIdOrPriority) {
      workPackageId = parseInt(workPackageIdOrPriority);
      finalPriority = priority;
    } else {
      throw new CommandError(
        "No ID provided",
        "You must provide a work package ID",
      );
    }
    if (isNaN(workPackageId)) {
      throw new CommandError(
        "Invalid work package ID",
        "Work Package ID must be a valid number",
      );
    }
    const priorities = await client.getPriorities();
    if (!finalPriority) {
      throw new CommandError(
        "Priority not provided",
        `Priority not provided. You can use ${priorities.map((t) => (t.name.includes(" ") ? `"${t.name}"` : t.name)).join(", ")}`,
      );
    }

    // Prefer the "closed" status, but if that fails then we'll just use whatever status is used for closed.
    const priorityRef =
      finalPriority &&
      (await client.getPriorities()).find(
        (s) => s.name.toLowerCase() === finalPriority?.toLowerCase(),
      );

    if (!priorityRef) {
      throw new CommandError(
        "Priority not understood",
        `Priority not understood. You can use ${priorities.map((t) => (t.name.includes(" ") ? `"${t.name}"` : t.name)).join(", ")}`,
      );
    }

    await client.updateWorkPackage(workPackageId, {
      _links: {
        priority: {
          href: priorityRef?._links.self.href,
        },
      },
    });
  }

  public async helperChangeWorkPackageUser(
    field: "assignee" | "responsible",
    userId: string,
    reply: MatrixEvent<unknown> | undefined,
    workPackageIdOrUser?: string,
    providedUser?: string,
  ) {
    const client = await this.tokenStore.getOpenProjectForUser(userId);
    if (!client) {
      throw new NotLoggedInError();
    }
    let assigneeName: string | undefined;
    let workPackageId;
    const replyWp = this.getWorkPackageIDFromReply(reply);
    if (replyWp) {
      workPackageId = replyWp;
      assigneeName = workPackageIdOrUser;
    } else if (workPackageIdOrUser) {
      workPackageId = parseInt(workPackageIdOrUser);
      assigneeName = providedUser;
    } else {
      throw new CommandError(
        "No ID provided",
        "You must provide a work package ID",
      );
    }
    if (isNaN(workPackageId)) {
      throw new CommandError(
        "Invalid work package ID",
        "Work Package ID must be a valid number",
      );
    }

    let userHref: { href: string | null };

    if (assigneeName) {
      if (["none", "unset"].includes(assigneeName.toLowerCase())) {
        userHref = { href: null };
      } else {
        try {
          const matrixId = new UserID(assigneeName);
          const userClient = await this.tokenStore.getOpenProjectForUser(
            matrixId.toString(),
          );
          if (!userClient) {
            throw new CommandError(
              "Invalid user",
              "Matrix user does not map to a OpenProject user",
            );
          }
          userHref = (await userClient.getIdentity())._links.self;
        } catch (ex) {
          if (ex instanceof CommandError) {
            throw ex;
          }
          // Not a matrix ID
          const foundUser = await client.searchForUserInProject(
            this.projectId,
            assigneeName,
          );
          if (!foundUser) {
            throw new CommandError(
              "Invalid user",
              "Could not find a user by that name",
            );
          }
          userHref = foundUser;
        }
      }
    } else {
      // Self assign.
      userHref = (await client.getIdentity())._links.self;
    }

    await client.updateWorkPackage(workPackageId, {
      _links: {
        [field]: {
          href: userHref.href,
        },
      },
    });
  }

  @botCommand("assign", {
    help: "Assign a work package to a new user (use 'unset' to remove)",
    optionalArgs: ["workPackageId", "assignee"],
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
  ) {
    return this.helperChangeWorkPackageUser(
      "assignee",
      userId,
      reply,
      workPackageIdOrAssignee,
      cliAssignee,
    );
  }

  @botCommand("responsible", {
    help: "Assign a responsible user to a work package (use 'unset' to remove)",
    optionalArgs: ["workPackageId", "responsibleUser"],
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
  ) {
    return this.helperChangeWorkPackageUser(
      "responsible",
      userId,
      reply,
      workPackageIdOrAssignee,
      cliAssignee,
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
