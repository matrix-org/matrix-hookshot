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
  MatrixEvent,
  MessageEventContent,
  StateEvent,
  UserID,
} from "matrix-bot-sdk";
import { Logger } from "matrix-appservice-bridge";
import markdownit from "markdown-it";
import { botCommand, BotCommands, compileBotCommands } from "../BotCommands";
import { MatrixMessageContent } from "../MatrixEvent";
import { CommandConnection } from "./CommandConnection";
import { UserTokenStore } from "../tokens/UserTokenStore";
import { ApiError, ErrCode } from "../api";
import { OpenProjectWebhookPayloadWorkPackage } from "../openproject/Types";
import { BridgeOpenProjectConfig } from "../config/sections/OpenProject";
import {
  formatWorkPackageDiff,
  formatWorkPackageForMatrix,
  OpenProjectWorkPackageMatrixEvent,
} from "../openproject/Format";
import { IBridgeStorageProvider } from "../stores/StorageProvider";
import { workPackageToCacheState } from "../openproject/State";
import { OpenProjectGrantChecker } from "../openproject/GrantChecker";
import { GetConnectionsResponseItem } from "../widgets/Api";
import { CommandError, NotLoggedInError } from "../Errors";

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
      ...extraData,
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
    await this.storage.setOpenProjectWorkPackageState(
      workPackageToCacheState(data.work_package),
      data.work_package.id,
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
      ...extraData,
    });
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
    const workPackage = await client.createWorkPackage(
      this.projectId,
      foundType,
      subject,
      finalDescription,
    );
    await this.storage.setOpenProjectWorkPackageState(
      workPackageToCacheState(workPackage),
      workPackage.id,
    );
    if (this.state.events.includes("work_package:created")) {
      // Don't send an event if we're going to anyway.
      return;
    }

    const extraData = formatWorkPackageForMatrix(
      workPackage,
      this.config.baseURL,
    );
    const content = `${workPackage._embedded.author.name} created a new work package [${workPackage.id}](${extraData["org.matrix.matrix-hookshot.openproject.work_package"].url}): "${workPackage.subject}"`;
    await this.intent.sendEvent(this.roomId, {
      msgtype: "m.notice",
      body: content,
      formatted_body: md.renderInline(content),
      format: "org.matrix.custom.html",
      ...extraData,
    });
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

    const workPackage = await client.updateWorkPackage(workPackageId, {
      _links: {
        status: {
          href: closedStatus?._links.self.href,
        },
      },
    });
    if (finalComment) {
      await client.addWorkPackageComment(workPackageId, finalComment);
    }
    if (this.state.events.includes("work_package:updated")) {
      // Don't send an event if we're going to anyway.
      return;
    }

    const extraData = formatWorkPackageForMatrix(
      workPackage,
      this.config.baseURL,
    );
    const content = `${workPackage._embedded.author.name} closed work package [${workPackage.id}](${extraData["org.matrix.matrix-hookshot.openproject.work_package"].url}): "${workPackage.subject}"`;
    await this.intent.sendEvent(this.roomId, {
      msgtype: "m.notice",
      body: content,
      formatted_body: md.renderInline(content),
      format: "org.matrix.custom.html",
      ...extraData,
    });
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

    const workPackage = await client.updateWorkPackage(workPackageId, {
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
