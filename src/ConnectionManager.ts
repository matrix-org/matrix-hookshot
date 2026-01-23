/**
 * Manages connections between Matrix rooms and the remote side.
 */

import { Appservice, Intent, MatrixError, StateEvent } from "matrix-bot-sdk";
import { ApiError, ErrCode } from "./api";
import { BridgeConfig, BridgePermissionLevel } from "./config/Config";
import { CommentProcessor } from "./CommentProcessor";
import {
  ConnectionDeclaration,
  ConnectionDeclarations,
  GenericHookConnection,
  GitHubDiscussionConnection,
  GitHubDiscussionSpace,
  GitHubIssueConnection,
  GitHubProjectConnection,
  GitHubRepoConnection,
  GitHubUserSpace,
  GitLabIssueConnection,
  GitLabRepoConnection,
  IConnection,
  IConnectionState,
  JiraProjectConnection,
} from "./Connections";
import { FigmaFileConnection, FeedConnection } from "./Connections";
import { GetConnectionTypeResponseItem } from "./widgets/Api";
import { GitLabClient } from "./gitlab/Client";
import { GithubInstance } from "./github/GithubInstance";
import { IBridgeStorageProvider } from "./stores/StorageProvider";
import { JiraProject, JiraVersion } from "./jira/Types";
import { Logger } from "matrix-appservice-bridge";
import { MessageSenderClient } from "./MatrixSender";
import { UserTokenStore } from "./tokens/UserTokenStore";
import BotUsersManager, { BotUser } from "./managers/BotUsersManager";
import { retry, retryMatrixErrorFilter } from "./PromiseUtil";
import Metrics from "./Metrics";
import EventEmitter from "events";
import { HoundConnection } from "./Connections/HoundConnection";
import { OpenProjectConnection } from "./Connections/OpenProjectConnection";
import { GitLabInstance } from "./config/sections";

const log = new Logger("ConnectionManager");

const GET_STATE_ATTEMPTS = 5;
const GET_STATE_TIMEOUT_MS = 1000;

export class ConnectionManager extends EventEmitter {
  private connections: IConnection[] = [];
  public readonly enabledForProvisioning: Record<
    string,
    GetConnectionTypeResponseItem
  > = {};
  private readonly pendingRoomUpgrades = new Set<string>(); // newRoomId

  public get size() {
    return this.connections.length;
  }

  constructor(
    private readonly as: Appservice,
    private readonly config: BridgeConfig,
    private readonly tokenStore: UserTokenStore,
    private readonly commentProcessor: CommentProcessor,
    private readonly messageClient: MessageSenderClient,
    private readonly storage: IBridgeStorageProvider,
    private readonly botUsersManager: BotUsersManager,
    private readonly github?: GithubInstance,
  ) {
    super();
  }

  /**
   * Push a new connection to the manager, if this connection already
   * exists then this will no-op.
   * @param connections The connection instances to push.
   */
  public push(...connections: IConnection[]) {
    for (const connection of connections) {
      if (
        this.connections.some((c) => c.connectionId === connection.connectionId)
      ) {
        return;
      }
      this.connections.push(connection);
      this.emit("new-connection", connection);
    }
    Metrics.connections.set(this.connections.length);
    // Already exists, noop.
  }

  /**
   * Used by the provisioner API to create new connections on behalf of users.
   *
   * @param roomId The target Matrix room.
   * @param intent Bot user intent to create the connection with.
   * @param userId The requesting Matrix user.
   * @param connectionType The connection declaration to provision.
   * @param data The data corresponding to the connection state. This will be validated.
   * @returns The resulting connection.
   */
  public async provisionConnection(
    roomId: string,
    intent: Intent,
    userId: string,
    connectionType: ConnectionDeclaration,
    data: Record<string, unknown>,
  ) {
    log.info(
      `Looking to provision connection for ${roomId} ${connectionType.ServiceCategory} for ${userId} with data ${JSON.stringify(data)}`,
    );
    if (connectionType?.provisionConnection) {
      if (
        !this.config.checkPermission(
          userId,
          connectionType.ServiceCategory,
          BridgePermissionLevel.manageConnections,
        )
      ) {
        throw new ApiError(
          `User is not permitted to provision connections for this type of service.`,
          ErrCode.ForbiddenUser,
        );
      }
      const result = await connectionType.provisionConnection(
        roomId,
        userId,
        data,
        {
          as: this.as,
          intent: intent,
          config: this.config,
          tokenStore: this.tokenStore,
          commentProcessor: this.commentProcessor,
          messageClient: this.messageClient,
          storage: this.storage,
          github: this.github,
          getAllConnectionsOfType: this.getAllConnectionsOfType.bind(this),
        },
      );
      this.push(result.connection);
      return result;
    }
    throw new ApiError(`Connection type not known`);
  }

  /**
   * Check if a state event is sent by a user who is allowed to configure the type of connection the state event covers.
   * If it isn't, optionally revert the state to the last-known valid value, or redact it if that isn't possible.
   * @param roomId The target Matrix room.
   * @param intent The bot intent to use.
   * @param state The state event for altering a connection in the room.
   * @param serviceType The type of connection the state event is altering.
   * @returns Whether the state event was allowed to be set. If not, the state will be reverted asynchronously.
   */
  public verifyStateEvent(
    roomId: string,
    intent: Intent,
    state: StateEvent,
    serviceType: string,
    rollbackBadState: boolean,
  ) {
    if (!this.isStateAllowed(roomId, state, serviceType)) {
      if (rollbackBadState) {
        void this.tryRestoreState(roomId, intent, state, serviceType);
      }
      log.error(
        `User ${state.sender} is disallowed to manage state for ${serviceType} in ${roomId}`,
      );
      return false;
    } else {
      return true;
    }
  }

  /**
   * The same as {@link verifyStateEvent}, but verifies the state event against the room & service type of the given connection.
   * @param connection The connection to verify the state event against.
   * @param state The state event for altering a connection in the room targeted by {@link connection}.
   * @returns Whether the state event was allowed to be set. If not, the state will be reverted asynchronously.
   */
  public verifyStateEventForConnection(
    connection: IConnection,
    state: StateEvent,
    rollbackBadState: boolean,
  ): boolean {
    const cd: ConnectionDeclaration =
      Object.getPrototypeOf(connection).constructor;
    const botUser = this.botUsersManager.getBotUserInRoom(
      connection.roomId,
      cd.ServiceCategory,
    );
    if (!botUser) {
      log.error(
        `Failed to find a bot in room '${connection.roomId}' for service type '${cd.ServiceCategory}' when verifying state for connection`,
      );
      throw Error("Could not find a bot to handle this connection");
    }
    return this.verifyStateEvent(
      connection.roomId,
      botUser.intent,
      state,
      cd.ServiceCategory,
      rollbackBadState,
    );
  }

  private isStateAllowed(
    roomId: string,
    state: StateEvent,
    serviceType: string,
  ) {
    return (
      this.botUsersManager.isBotUser(state.sender) ||
      this.config.checkPermission(
        state.sender,
        serviceType,
        BridgePermissionLevel.manageConnections,
      )
    );
  }

  private async tryRestoreState(
    roomId: string,
    intent: Intent,
    originalState: StateEvent,
    serviceType: string,
  ) {
    let state = originalState;
    let attemptsRemaining = 5;
    try {
      do {
        if (state.unsigned.replaces_state) {
          state = new StateEvent(
            await intent.underlyingClient.getEvent(
              roomId,
              state.unsigned.replaces_state,
            ),
          );
        } else {
          await intent.underlyingClient.redactEvent(
            roomId,
            originalState.eventId,
            `User ${originalState.sender} is disallowed to manage state for ${serviceType} in ${roomId}`,
          );
          return;
        }
      } while (
        --attemptsRemaining > 0 &&
        !this.isStateAllowed(roomId, state, serviceType)
      );
      await intent.underlyingClient.sendStateEvent(
        roomId,
        state.type,
        state.stateKey,
        state.content,
      );
    } catch (ex) {
      log.warn(
        `Unable to undo state event from ${state.sender} for disallowed ${serviceType} connection management in ${roomId}`,
      );
    }
  }

  /**
   * This is called when we spot new state in a room and want to create a connection for it.
   * @param roomId The room where the connection is being created.
   * @param state The state event for the connection.
   * @param rollbackBadState If we can't create a connection, should the state be "rolled back"?
   * @param isStatic Is the connection coming from the config, and therefore immutable?
   * @returns
   */
  public async createConnectionForState(
    roomId: string,
    state: StateEvent<any>,
    rollbackBadState: boolean,
    isStatic = false,
  ): Promise<IConnection | undefined> {
    // Empty object == redacted
    if (
      state.content.disabled === true ||
      Object.keys(state.content).length === 0
    ) {
      log.debug(`${roomId} has disabled state for ${state.type}`);
      return;
    }
    const connectionType = this.getConnectionTypeForEventType(state.type);
    if (!connectionType) {
      return;
    }

    if (!this.config.enabledServices.includes(connectionType.ServiceCategory)) {
      log.warn(
        `Skipping ${state.type} for ${roomId} as service is not enabled`,
      );
      return;
    }

    // Get a bot user for the connection type
    const botUser = this.botUsersManager.getBotUserInRoom(
      roomId,
      connectionType.ServiceCategory,
    );
    if (!botUser) {
      log.error(
        `Failed to find a bot in room '${roomId}' for service type '${connectionType.ServiceCategory}' when creating connection for state`,
      );
      throw Error("Could not find a bot to handle this connection");
    }

    // Don't verify a static connection.
    if (
      !isStatic &&
      !this.verifyStateEvent(
        roomId,
        botUser.intent,
        state,
        connectionType.ServiceCategory,
        rollbackBadState,
      )
    ) {
      return;
    }

    try {
      const connection = await connectionType.createConnectionForState(
        roomId,
        state,
        {
          as: this.as,
          intent: botUser.intent,
          config: this.config,
          tokenStore: this.tokenStore,
          commentProcessor: this.commentProcessor,
          messageClient: this.messageClient,
          storage: this.storage,
          github: this.github,
          isStatic,
        },
      );
      if (!isStatic) {
        // Finally, ensure the connection is allowed by us.
        await connection.ensureGrant?.(state.sender);
      }
      return connection;
    } catch (ex) {
      log.error(
        `Not creating connection for state ${roomId}/${state.type}`,
        ex,
      );
      return;
    }
  }

  /**
   * This is called when hookshot starts up, or a hookshot service bot has left
   * and we need to recalculate the right bots for all the connections in a room.
   * @param roomId
   * @param rollbackBadState
   * @returns
   */
  public async createConnectionsForRoomId(
    roomId: string,
    rollbackBadState: boolean,
  ) {
    const botUser = this.botUsersManager.getBotUserInRoom(roomId);
    if (!botUser) {
      log.error(
        `Failed to find a bot in room '${roomId}' when creating connections`,
      );
      return;
    }

    // If the room has a tombstone, we never create connections inside of it.
    try {
      await botUser.intent.underlyingClient.getRoomStateEventContent(
        roomId,
        "m.room.tombstone",
        "",
      );
      return;
    } catch (ex) {
      if (ex instanceof MatrixError === false || ex.errcode !== "M_NOT_FOUND") {
        throw ex;
      }
      // No tombstone, so room is valid.
    }

    // This endpoint can be heavy, wrap it in pillows.
    const state = await retry(
      () => botUser.intent.underlyingClient.getRoomState(roomId),
      GET_STATE_ATTEMPTS,
      GET_STATE_TIMEOUT_MS,
      retryMatrixErrorFilter,
    );

    for (const event of state) {
      try {
        const conn = await this.createConnectionForState(
          roomId,
          new StateEvent(event),
          rollbackBadState,
        );
        if (conn) {
          log.debug(`Room ${roomId} is connected to: ${conn}`);
          this.push(conn);
        }
      } catch (ex) {
        log.error(`Failed to create connection for ${roomId}:`, ex);
      }
    }

    // Create static connections
    for (const staticConfig of this.config.connections.filter(
      (c) => c.roomId === roomId,
    )) {
      try {
        const conn = await this.createConnectionForState(
          roomId,
          new StateEvent({
            room_id: roomId,
            type: staticConfig.connectionType,
            state_key: staticConfig.stateKey,
            content: staticConfig.state,
          }),
          false,
          true,
        );
        if (conn) {
          log.debug(
            `Room ${roomId} is connected to: ${conn} (via static config)`,
          );
          this.push(conn);
        }
      } catch (ex) {
        log.error(
          `Failed to create connection for ${roomId} (via static config):`,
          ex,
        );
      }
    }
  }

  public getConnectionsForGithubIssue(
    org: string,
    repo: string,
    issueNumber: number,
  ): (GitHubIssueConnection | GitHubRepoConnection)[] {
    org = org.toLowerCase();
    repo = repo.toLowerCase();
    return this.connections.filter(
      (c) =>
        (c instanceof GitHubIssueConnection &&
          c.org === org &&
          c.repo === repo &&
          c.issueNumber === issueNumber) ||
        (c instanceof GitHubRepoConnection && c.org === org && c.repo === repo),
    ) as (GitHubIssueConnection | GitHubRepoConnection)[];
  }

  public getConnectionsForGithubRepo(
    org: string,
    repo: string,
  ): GitHubRepoConnection[] {
    org = org.toLowerCase();
    repo = repo.toLowerCase();
    return this.connections.filter(
      (c) =>
        c instanceof GitHubRepoConnection && c.org === org && c.repo === repo,
    ) as GitHubRepoConnection[];
  }

  public getConnectionsForGithubRepoDiscussion(
    owner: string,
    repo: string,
  ): GitHubDiscussionSpace[] {
    owner = owner.toLowerCase();
    repo = repo.toLowerCase();
    return this.connections.filter(
      (c) =>
        c instanceof GitHubDiscussionSpace &&
        c.owner === owner &&
        c.repo === repo,
    ) as GitHubDiscussionSpace[];
  }

  public getConnectionForGithubUser(user: string): GitHubUserSpace {
    return this.connections.find(
      (c) => c instanceof GitHubUserSpace && c.owner === user.toLowerCase(),
    ) as GitHubUserSpace;
  }

  public getConnectionsForGithubDiscussion(
    owner: string,
    repo: string,
    discussionNumber: number,
  ) {
    owner = owner.toLowerCase();
    repo = repo.toLowerCase();
    return this.connections.filter(
      (c) =>
        c instanceof GitHubDiscussionConnection &&
        c.owner === owner &&
        c.repo === repo &&
        c.discussionNumber === discussionNumber,
    ) as GitHubDiscussionConnection[];
  }

  public getForGitHubProject(projectId: number): GitHubProjectConnection[] {
    return this.connections.filter(
      (c) => c instanceof GitHubProjectConnection && c.projectId === projectId,
    ) as GitHubProjectConnection[];
  }

  public getConnectionsForGitLabIssueWebhook(
    repoHome: string,
    issueId: number,
  ) {
    if (!this.config.gitlab) {
      throw Error("GitLab configuration missing, cannot handle note");
    }
    const res = GitLabClient.splitUrlIntoParts(
      this.config.gitlab.instances,
      repoHome,
    );
    if (!res) {
      throw Error("No instance found for note");
    }
    const instance = this.config.gitlab.instances[res[0]];
    return this.getConnectionsForGitLabIssue(instance, res[1], issueId);
  }

  public getConnectionsForGitLabIssue(
    instance: GitLabInstance,
    projects: string[],
    issueNumber: number,
  ): GitLabIssueConnection[] {
    return this.connections.filter(
      (c) =>
        c instanceof GitLabIssueConnection &&
        c.issueNumber == issueNumber &&
        c.instanceUrl == instance.url &&
        c.projectPath == projects.join("/"),
    ) as GitLabIssueConnection[];
  }

  public getConnectionsForGitLabRepo(
    pathWithNamespace: string,
  ): GitLabRepoConnection[] {
    pathWithNamespace = pathWithNamespace.toLowerCase();
    return this.connections.filter(
      (c) => c instanceof GitLabRepoConnection && c.path === pathWithNamespace,
    ) as GitLabRepoConnection[];
  }

  public getConnectionsForJiraProject(
    project: JiraProject,
  ): JiraProjectConnection[] {
    return this.connections.filter(
      (c) =>
        c instanceof JiraProjectConnection && c.interestedInProject(project),
    ) as JiraProjectConnection[];
  }

  public getConnectionsForJiraVersion(
    version: JiraVersion,
  ): JiraProjectConnection[] {
    return this.connections.filter(
      (c) =>
        c instanceof JiraProjectConnection && c.interestedInVersion(version),
    ) as JiraProjectConnection[];
  }

  public getConnectionsForGenericWebhook(
    hookId: string,
  ): GenericHookConnection[] {
    return this.connections.filter(
      (c) => c instanceof GenericHookConnection && c.hookId === hookId,
    ) as GenericHookConnection[];
  }

  public getForFigmaFile(
    fileKey: string,
    instanceName: string,
  ): FigmaFileConnection[] {
    return this.connections.filter(
      (c) =>
        c instanceof FigmaFileConnection &&
        (c.fileId === fileKey || c.instanceName === instanceName),
    ) as FigmaFileConnection[];
  }

  public getConnectionsForFeedUrl(url: string): FeedConnection[] {
    return this.connections.filter(
      (c) => c instanceof FeedConnection && c.feedUrl === url,
    ) as FeedConnection[];
  }

  public getConnectionsForHoundChallengeId(
    challengeId: string,
  ): HoundConnection[] {
    return this.connections.filter(
      (c) => c instanceof HoundConnection && c.challengeId === challengeId,
    ) as HoundConnection[];
  }

  public getConnectionsForOpenProject(
    projectId: number,
  ): OpenProjectConnection[] {
    return this.connections.filter(
      (c) =>
        c instanceof OpenProjectConnection && c.interestedInProject(projectId),
    ) as OpenProjectConnection[];
  }

  public getAllConnectionsOfType<T extends IConnection>(
    typeT: new (...params: any[]) => T,
  ): T[] {
    return this.connections.filter((c) => c instanceof typeT) as T[];
  }

  public getConnectionTypeForEventType(
    eventType: string,
  ): ConnectionDeclaration | undefined {
    return ConnectionDeclarations.find((c) => c.EventTypes.includes(eventType));
  }

  public isRoomConnected(roomId: string): boolean {
    return !!this.connections.find((c) => c.roomId === roomId);
  }

  public getAllConnectionsForRoom(roomId: string): IConnection[] {
    return this.connections
      .filter((c) => c.roomId === roomId)
      .sort((a, b) => b.priority - a.priority);
  }

  public getInterestedForRoomState(
    roomId: string,
    eventType: string,
    stateKey: string,
  ): IConnection[] {
    return this.connections.filter(
      (c) =>
        c.roomId === roomId && c.isInterestedInStateEvent(eventType, stateKey),
    );
  }

  public getConnectionById(roomId: string, connectionId: string) {
    return this.connections.find(
      (c) => c.connectionId === connectionId && c.roomId === roomId,
    );
  }

  public validateCommandPrefix(
    roomId: string,
    config: IConnectionState,
    currentConnection?: IConnection,
  ) {
    if (config.commandPrefix === undefined) return;
    for (const c of this.getAllConnectionsForRoom(roomId)) {
      if (
        c != currentConnection &&
        c.conflictsWithCommandPrefix?.(config.commandPrefix)
      ) {
        throw new ApiError(
          `Command prefix "${config.commandPrefix}" is already used in this room. Please choose another prefix.`,
          ErrCode.ConflictingConnection,
          -1,
          {
            existingConnection: c.getProvisionerDetails?.(),
          },
        );
      }
    }
  }

  public async purgeConnection(
    roomId: string,
    connectionId: string,
    requireNoRemoveHandler = true,
  ) {
    const connection = this.connections.find(
      (c) => c.connectionId === connectionId && c.roomId == roomId,
    );
    if (!connection) {
      throw Error("Connection not found");
    }
    if (requireNoRemoveHandler && !connection.onRemove) {
      throw Error(
        "Connection doesn't support removal, and so cannot be safely removed",
      );
    }
    await connection.onRemove?.();
    const connectionIndex = this.connections.indexOf(connection);
    if (connectionIndex === -1) {
      throw Error("Could not find connection index");
    }
    this.connections.splice(connectionIndex, 1);
    Metrics.connections.set(this.connections.length);
    this.emit("connection-removed", connection);
  }

  /**
   * Removes connections for a room from memory. This does NOT remove the state
   * event from the room.
   * @param roomId
   */
  public async removeConnectionsForRoom(roomId: string) {
    log.info(`Removing all connections from ${roomId}`);
    this.connections = this.connections.filter((c) => c.roomId !== roomId);
    Metrics.connections.set(this.connections.length);
  }

  public registerProvisioningConnection(connType: {
    getProvisionerDetails: (botUserId: string) => GetConnectionTypeResponseItem;
  }) {
    const details = connType.getProvisionerDetails(this.as.botUserId);
    if (this.enabledForProvisioning[details.type]) {
      throw Error(`Type "${details.type}" already registered for provisioning`);
    }
    this.enabledForProvisioning[details.type] = details;
  }

  /**
   * Get a list of possible targets for a given connection type when provisioning
   * @param userId
   * @param type
   */
  async getConnectionTargets(
    userId: string,
    type: string,
    filters: Record<string, unknown> = {},
  ): Promise<unknown[]> {
    switch (type) {
      case GitLabRepoConnection.CanonicalEventType: {
        const configObject = this.validateConnectionTarget(
          userId,
          this.config.gitlab,
          "GitLab",
          "gitlab",
        );
        return await GitLabRepoConnection.getConnectionTargets(
          userId,
          configObject,
          filters,
          this.tokenStore,
          this.storage,
        );
      }
      case GitHubRepoConnection.CanonicalEventType: {
        this.validateConnectionTarget(
          userId,
          this.config.github,
          "GitHub",
          "github",
        );
        if (!this.github) {
          throw Error("GitHub instance was never initialized");
        }
        return await GitHubRepoConnection.getConnectionTargets(
          userId,
          this.tokenStore,
          this.github,
          filters,
        );
      }
      case JiraProjectConnection.CanonicalEventType: {
        const configObject = this.validateConnectionTarget(
          userId,
          this.config.jira,
          "JIRA",
          "jira",
        );
        return await JiraProjectConnection.getConnectionTargets(
          userId,
          this.tokenStore,
          configObject,
          filters,
        );
      }
      case OpenProjectConnection.CanonicalEventType: {
        this.validateConnectionTarget(
          userId,
          this.config.openProject,
          "OpenProject",
          "openproject",
        );
        return await OpenProjectConnection.getConnectionTargets(
          userId,
          this.tokenStore,
          filters,
        );
      }
      default:
        throw new ApiError(
          `Connection type doesn't support getting targets or is not known`,
          ErrCode.NotFound,
        );
    }
  }

  private validateConnectionTarget<T>(
    userId: string,
    configObject: T | undefined,
    serviceName: string,
    serviceId: string,
  ): T {
    if (!configObject) {
      throw new ApiError(
        `${serviceName} is not configured`,
        ErrCode.DisabledFeature,
      );
    }
    if (
      !this.config.checkPermission(
        userId,
        serviceId,
        BridgePermissionLevel.manageConnections,
      )
    ) {
      throw new ApiError(
        `User is not permitted to provision connections for ${serviceName}`,
        ErrCode.ForbiddenUser,
      );
    }
    return configObject;
  }

  // Room Upgrades
  public async onTombstoneEvent(currentRoomId: string, newRoomId: string) {
    log.info(
      `Checking whether room upgrade can progress ${currentRoomId} -> ${newRoomId}`,
    );
    this.pendingRoomUpgrades.add(newRoomId);

    for (const botUser of this.botUsersManager.getBotUsersInRoom(
      currentRoomId,
    )) {
      // Ensure all the bots from the old room join the new one
      try {
        log.debug(`Trying to join ${botUser.userId} to ${newRoomId}`);
        await botUser.intent.joinRoom(newRoomId);
      } catch (ex) {
        // May just be because we're too quick
        log.debug(`Failed to join ${botUser.userId} to ${newRoomId}`, ex);
      }
    }

    // Run check asynchronously
    void this.checkAndMigrateUpgradedRoom(newRoomId);
  }

  public checkAndMigrateIfPendingUpgrade(
    newRoomId: string,
    eventTypeToLog: string,
  ) {
    if (this.pendingRoomUpgrades.has(newRoomId)) {
      log.debug(`Got ${eventTypeToLog} event for upgraded room ${newRoomId}`);
      // Run check asynchronously
      void this.checkAndMigrateUpgradedRoom(newRoomId);
    }
  }

  private async checkAndMigrateUpgradedRoom(newRoomId: string) {
    // Remove the room from the set while we process it to prevent concurrent attempts.
    this.pendingRoomUpgrades.delete(newRoomId);
    let bot: BotUser | undefined;
    let oldRoomId: string | undefined;
    try {
      // NOTE: We just care about having *any* bot in the room, rather than the specific
      // service bot. We just need one bot that can send the appropriate state.
      bot = this.botUsersManager.getBotUserInRoom(newRoomId);
      if (!bot) {
        log.debug("Bot not in room yet, not performing any actions");
        this.pendingRoomUpgrades.add(newRoomId);
        return;
      }
      const hasPowerlevel =
        await bot.intent.underlyingClient.userHasPowerLevelFor(
          bot.intent.userId,
          newRoomId,
          "im.vector.modular.widgets",
          true,
        );

      if (!hasPowerlevel) {
        log.debug("Bot does not have power in the upgraded room, skipping");
        this.pendingRoomUpgrades.add(newRoomId);
        return;
      }
      const createEvent =
        await bot.intent.underlyingClient.getRoomCreateEvent(newRoomId);
      oldRoomId = createEvent.content.predecessor?.room_id;
      if (!oldRoomId) {
        log.error(
          "Upgraded room has no predecessor, which means the upgrade is invalid. Ignoring upgrade!",
        );
        return;
      }
    } catch (ex) {
      // We hit an unexpected failure, so add back to the set.
      this.pendingRoomUpgrades.add(newRoomId);
      throw ex;
    }
    log.info("New room is ready for upgrade!", newRoomId);
    for (const connection of this.getAllConnectionsForRoom(oldRoomId)) {
      if (connection.isStatic) {
        // Static connections cannot be migrated.
        continue;
      }
      if (connection.migrateToNewRoom) {
        await connection.migrateToNewRoom(newRoomId);
        log.warn(`Connection ${connection.toString()} migrated`);
      } else {
        log.warn(`Connection type ${newRoomId} does not support migration`);
      }
    }
    log.info(
      "New room fully migrated, removing connections from old room",
      oldRoomId,
    );
    await this.removeConnectionsForRoom(oldRoomId);
  }
}
