

/**
 * Manages connections between Matrix rooms and the remote side.
 */

import { Appservice, StateEvent } from "matrix-bot-sdk";
import { CommentProcessor } from "./CommentProcessor";
import { BridgeConfig, BridgePermissionLevel, GitLabInstance } from "./Config/Config";
import { ConnectionDeclaration, ConnectionDeclarations, GenericHookConnection, GitHubDiscussionConnection, GitHubDiscussionSpace, GitHubIssueConnection, GitHubProjectConnection, GitHubRepoConnection, GitHubUserSpace, GitLabIssueConnection, GitLabRepoConnection, IConnection, IConnectionState, JiraProjectConnection } from "./Connections";
import { GithubInstance } from "./Github/GithubInstance";
import { GitLabClient } from "./Gitlab/Client";
import { JiraProject, JiraVersion } from "./Jira/Types";
import { Logger } from "matrix-appservice-bridge";
import { MessageSenderClient } from "./MatrixSender";
import { GetConnectionTypeResponseItem } from "./provisioning/api";
import { ApiError, ErrCode } from "./api";
import { UserTokenStore } from "./UserTokenStore";
import { FigmaFileConnection, FeedConnection } from "./Connections";
import { IBridgeStorageProvider } from "./Stores/StorageProvider";
import Metrics from "./Metrics";
import EventEmitter from "events";
import { AdminAccountData } from "./AdminRoomCommandHandler";
import { AdminRoom, BRIDGE_ROOM_TYPE, LEGACY_BRIDGE_ROOM_TYPE } from "./AdminRoom";
import { NotifFilter, NotificationFilterStateContent } from "./NotificationFilters";
import { ProjectsGetResponseData } from "./Github/Types";
import { GetIssueOpts, GetIssueResponse } from "./Gitlab/Types";
import { SetupWidget } from "./Widgets/SetupWidget";
import { NotificationsDisableEvent, NotificationsEnableEvent } from "./Webhooks";
import { MessageQueue } from "./MessageQueue";
import { getSafeRoomAccountData } from "./AccountData";

const log = new Logger("ConnectionManager");

export class ConnectionManager extends EventEmitter {
    private connections: IConnection[] = [];
    public readonly enabledForProvisioning: Record<string, GetConnectionTypeResponseItem> = {};
    // roomId -> AdminRoom
    private adminRooms: Map<string, AdminRoom> = new Map();

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
        private readonly queue: MessageQueue,
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
            if (this.connections.some(c => c.connectionId === connection.connectionId)) {
                return;
            }
            this.connections.push(connection);
            this.emit('new-connection', connection);
        }
        Metrics.connections.set(this.connections.length);
        // Already exists, noop.
    }

    /**
     * Used by the provisioner API to create new connections on behalf of users.
     * @param roomId The target Matrix room.
     * @param userId The requesting Matrix user.
     * @param type The type of room (corresponds to the event type of the connection)
     * @param data The data corresponding to the connection state. This will be validated.
     * @returns The resulting connection.
     */
    public async provisionConnection(roomId: string, userId: string, type: string, data: Record<string, unknown>) {
        log.info(`Looking to provision connection for ${roomId} ${type} for ${userId} with data ${JSON.stringify(data)}`);
        const connectionType = ConnectionDeclarations.find(c => c.EventTypes.includes(type));
        if (connectionType?.provisionConnection) {
            if (!this.config.checkPermission(userId, connectionType.ServiceCategory, BridgePermissionLevel.manageConnections)) {
                throw new ApiError(`User is not permitted to provision connections for this type of service.`, ErrCode.ForbiddenUser);
            }
            const result = await connectionType.provisionConnection(roomId, userId, data, {
                as: this.as,
                config: this.config,
                tokenStore: this.tokenStore,
                commentProcessor: this.commentProcessor,
                messageClient: this.messageClient,
                storage: this.storage,
                github: this.github,
                getAllConnectionsOfType: this.getAllConnectionsOfType.bind(this),
            });
            this.push(result.connection);
            return result;
        }
        throw new ApiError(`Connection type not known`);
    }

    /**
     * Check if a state event is sent by a user who is allowed to configure the type of connection the state event covers.
     * If it isn't, optionally revert the state to the last-known valid value, or redact it if that isn't possible.
     * @param roomId The target Matrix room.
     * @param state The state event for altering a connection in the room.
     * @param serviceType The type of connection the state event is altering.
     * @returns Whether the state event was allowed to be set. If not, the state will be reverted asynchronously.
     */
    public verifyStateEvent(roomId: string, state: StateEvent, serviceType: string, rollbackBadState: boolean) {
        if (!this.isStateAllowed(roomId, state, serviceType)) {
            if (rollbackBadState) {
                void this.tryRestoreState(roomId, state, serviceType);
            }
            log.error(`User ${state.sender} is disallowed to manage state for ${serviceType} in ${roomId}`);
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
    public verifyStateEventForConnection(connection: IConnection, state: StateEvent, rollbackBadState: boolean) {
        const cd: ConnectionDeclaration = Object.getPrototypeOf(connection).constructor;
        return !this.verifyStateEvent(connection.roomId, state, cd.ServiceCategory, rollbackBadState);
    }

    private isStateAllowed(roomId: string, state: StateEvent, serviceType: string) {
        return state.sender === this.as.botUserId
            || this.config.checkPermission(state.sender, serviceType, BridgePermissionLevel.manageConnections);
    }

    private async tryRestoreState(roomId: string, originalState: StateEvent, serviceType: string) {
        let state = originalState;
        let attemptsRemaining = 5;
        try {
            do {
                if (state.unsigned.replaces_state) {
                    state = new StateEvent(await this.as.botClient.getEvent(roomId, state.unsigned.replaces_state));
                } else {
                    await this.as.botClient.redactEvent(roomId, originalState.eventId,
                        `User ${originalState.sender} is disallowed to manage state for ${serviceType} in ${roomId}`);
                    return;
                }
            } while (--attemptsRemaining > 0 && !this.isStateAllowed(roomId, state, serviceType));
            await this.as.botClient.sendStateEvent(roomId, state.type, state.stateKey, state.content);
        } catch (ex) {
            log.warn(`Unable to undo state event from ${state.sender} for disallowed ${serviceType} connection management in ${roomId}`);
        }
    }

    public createConnectionForState(roomId: string, state: StateEvent<any>, rollbackBadState: boolean) {
        // Empty object == redacted
        if (state.content.disabled === true || Object.keys(state.content).length === 0) {
            log.debug(`${roomId} has disabled state for ${state.type}`);
            return;
        }
        const connectionType = ConnectionDeclarations.find(c => c.EventTypes.includes(state.type));
        if (!connectionType) {
            return;
        }
        if (!this.verifyStateEvent(roomId, state, connectionType.ServiceCategory, rollbackBadState)) {
            return;
        }
        return connectionType.createConnectionForState(roomId, state, {
            as: this.as,
            config: this.config,
            tokenStore: this.tokenStore,
            commentProcessor: this.commentProcessor,
            messageClient: this.messageClient,
            storage: this.storage,
            github: this.github,
        });
    }

    public async createConnectionsForRoomId(roomId: string, rollbackBadState: boolean) {
        let connectionCreated = false;
        const state = await this.as.botClient.getRoomState(roomId);
        for (const event of state) {
            try {
                const conn = await this.createConnectionForState(roomId, new StateEvent(event), rollbackBadState);
                if (conn) {
                    log.debug(`Room ${roomId} is connected to: ${conn}`);
                    this.push(conn);
                    connectionCreated = true;
                }
            } catch (ex) {
                log.error(`Failed to create connection for ${roomId}:`, ex);
            }
        }
        return connectionCreated;
    }

    public async getOrCreateAdminRoomForUser(userId: string): Promise<AdminRoom> {
        const existingRoom = this.getAdminRoomByUserId(userId);
        if (existingRoom) {
            return existingRoom;
        }
        const roomId = await this.as.botClient.dms.getOrCreateDm(userId);
        const room = await this.setUpAdminRoom(roomId, {admin_user: userId}, NotifFilter.getDefaultContent());
        await this.as.botClient.setRoomAccountData(
            BRIDGE_ROOM_TYPE, roomId, room.accountData,
        );
        return room;
    }

    public async setUpAdminRoom(roomId: string, accountData: AdminAccountData, notifContent: NotificationFilterStateContent): Promise<AdminRoom> {
        const adminRoom = new AdminRoom(
            roomId, accountData, notifContent, this.as.botIntent, this.tokenStore, this.config, this,
        );

        adminRoom.on("settings.changed", this.onAdminRoomSettingsChanged.bind(this));
        adminRoom.on("open.project", async (project: ProjectsGetResponseData) => {
            const [connection] = this.getForGitHubProject(project.id) || [];
            if (!connection) {
                const connection = await GitHubProjectConnection.onOpenProject(project, this.as, adminRoom.userId);
                this.push(connection);
            } else {
                await this.as.botClient.inviteUser(adminRoom.userId, connection.roomId);
            }
        });
        adminRoom.on("open.gitlab-issue", async (issueInfo: GetIssueOpts, res: GetIssueResponse, instanceName: string, instance: GitLabInstance) => {
            if (!this.config.gitlab) {
                return;
            }
            const [ connection ] = this.getConnectionsForGitLabIssue(instance, issueInfo.projects, issueInfo.issue) || [];
            if (connection) {
                return this.as.botClient.inviteUser(adminRoom.userId, connection.roomId);
            } 
            const newConnection = await GitLabIssueConnection.createRoomForIssue(
                instanceName,
                instance,
                res,
                issueInfo.projects,
                this.as,
                this.tokenStore, 
                this.commentProcessor,
                this.messageClient,
                this.config.gitlab,
            );
            this.push(newConnection);
            return this.as.botClient.inviteUser(adminRoom.userId, newConnection.roomId);
        });
        this.adminRooms.set(roomId, adminRoom);
        if (this.config.widgets?.addToAdminRooms) {
            await SetupWidget.SetupAdminRoomConfigWidget(roomId, this.as.botIntent, this.config.widgets);
        }
        log.debug(`Set up ${roomId} as an admin room for ${adminRoom.userId}`);
        return adminRoom;
    }

    private async onAdminRoomSettingsChanged(adminRoom: AdminRoom, settings: AdminAccountData, oldSettings: AdminAccountData) {
        log.debug(`Settings changed for ${adminRoom.userId}`, settings);
        // Make this more efficent.
        if (!oldSettings.github?.notifications?.enabled && settings.github?.notifications?.enabled) {
            log.info(`Notifications enabled for ${adminRoom.userId}`);
            const token = await this.tokenStore.getGitHubToken(adminRoom.userId);
            if (token) {
                log.info(`Notifications enabled for ${adminRoom.userId} and token was found`);
                await this.queue.push<NotificationsEnableEvent>({
                    eventName: "notifications.user.enable",
                    sender: "Bridge",
                    data: {
                        userId: adminRoom.userId,
                        roomId: adminRoom.roomId,
                        token,
                        since: await adminRoom.getNotifSince("github"),
                        filterParticipating: adminRoom.notificationsParticipating("github"),
                        type: "github",
                        instanceUrl: undefined,
                    },
                });
            } else {
                log.warn(`Notifications enabled for ${adminRoom.userId} but no token stored!`);
            }
        } else if (oldSettings.github?.notifications?.enabled && !settings.github?.notifications?.enabled) {
            await this.queue.push<NotificationsDisableEvent>({
                eventName: "notifications.user.disable",
                sender: "Bridge",
                data: {
                    userId: adminRoom.userId,
                    type: "github",
                    instanceUrl: undefined,
                },
            });
        }

        for (const [instanceName, instanceSettings] of Object.entries(settings.gitlab || {})) {
            const instanceUrl = this.config.gitlab?.instances[instanceName].url;
            const token = await this.tokenStore.getUserToken("gitlab", adminRoom.userId, instanceUrl);
            if (token && instanceSettings.notifications.enabled) {
                log.info(`GitLab ${instanceName} notifications enabled for ${adminRoom.userId}`);
                await this.queue.push<NotificationsEnableEvent>({
                    eventName: "notifications.user.enable",
                    sender: "Bridge",
                    data: {
                        userId: adminRoom.userId,
                        roomId: adminRoom.roomId,
                        token,
                        since: await adminRoom.getNotifSince("gitlab", instanceName),
                        filterParticipating: adminRoom.notificationsParticipating("gitlab"),
                        type: "gitlab",
                        instanceUrl,
                    },
                });
            } else if (!instanceSettings.notifications.enabled) {
                log.info(`GitLab ${instanceName} notifications disabled for ${adminRoom.userId}`);
                await this.queue.push<NotificationsDisableEvent>({
                    eventName: "notifications.user.disable",
                    sender: "Bridge",
                    data: {
                        userId: adminRoom.userId,
                        type: "gitlab",
                        instanceUrl,
                    },
                });
            }
        }
    }

    public async initRooms() {
        const joinedRooms = await this.as.botClient.getJoinedRooms();
        for (const roomId of joinedRooms) {
            log.debug("Fetching state for " + roomId);
            try {
                await this.createConnectionsForRoomId(roomId, false);
            } catch (ex) {
                log.error(`Unable to create connection for ${roomId}`, ex);
                return;
            }

            // TODO: Refactor this to be a connection
            try {
                let accountData = await getSafeRoomAccountData<AdminAccountData>(
                    this.as.botClient,
                    BRIDGE_ROOM_TYPE,
                    roomId,
                );
                if (!accountData) {
                    accountData = await this.as.botClient.getSafeRoomAccountData<AdminAccountData>(
                        LEGACY_BRIDGE_ROOM_TYPE, roomId,
                    );
                    if (!accountData) {
                        log.debug(`Room ${roomId} has no connections and is not an admin room`);
                        return;
                    } else {
                        // Upgrade the room
                        await this.as.botClient.setRoomAccountData(BRIDGE_ROOM_TYPE, roomId, accountData);
                    }
                }

                let notifContent;
                try {
                    notifContent = await this.as.botClient.getRoomStateEvent(
                        roomId, NotifFilter.StateType, "",
                    );
                } catch (ex) {
                    try {
                        notifContent = await this.as.botClient.getRoomStateEvent(
                            roomId, NotifFilter.LegacyStateType, "",
                        );
                    }
                    catch (ex) {
                        // No state yet
                    }
                }
                const adminRoom = await this.setUpAdminRoom(roomId, accountData, notifContent || NotifFilter.getDefaultContent());
                // Call this on startup to set the state
                await this.onAdminRoomSettingsChanged(adminRoom, accountData, { admin_user: accountData.admin_user });
                log.debug(`Room ${roomId} is connected to: ${adminRoom.toString()}`);
            } catch (ex) {
                log.error(`Failed to set up admin room ${roomId}:`, ex);
            }
        }
    }

    public getConnectionsForGithubIssue(org: string, repo: string, issueNumber: number): (GitHubIssueConnection|GitHubRepoConnection)[] {
        org = org.toLowerCase();
        repo = repo.toLowerCase();
        return this.connections.filter((c) => (c instanceof GitHubIssueConnection && c.org === org && c.repo === repo && c.issueNumber === issueNumber) ||
            (c instanceof GitHubRepoConnection && c.org === org && c.repo === repo)) as (GitHubIssueConnection|GitHubRepoConnection)[];
    }

    public getConnectionsForGithubRepo(org: string, repo: string): GitHubRepoConnection[] {
        org = org.toLowerCase();
        repo = repo.toLowerCase();
        return this.connections.filter((c) => (c instanceof GitHubRepoConnection && c.org === org && c.repo === repo)) as GitHubRepoConnection[];
    }

    public getConnectionsForGithubRepoDiscussion(owner: string, repo: string): GitHubDiscussionSpace[] {
        owner = owner.toLowerCase();
        repo = repo.toLowerCase();
        return this.connections.filter((c) => (c instanceof GitHubDiscussionSpace && c.owner === owner && c.repo === repo)) as GitHubDiscussionSpace[];
    }

    public getConnectionForGithubUser(user: string): GitHubUserSpace {
        return this.connections.find(c => c instanceof GitHubUserSpace && c.owner === user.toLowerCase()) as GitHubUserSpace;
    }

    public getConnectionsForGithubDiscussion(owner: string, repo: string, discussionNumber: number) {
        owner = owner.toLowerCase();
        repo = repo.toLowerCase();
        return this.connections.filter(
            c => (
                c instanceof GitHubDiscussionConnection &&
                c.owner === owner &&
                c.repo === repo &&
                c.discussionNumber === discussionNumber
            )
        ) as GitHubDiscussionConnection[];
    }

    public getForGitHubProject(projectId: number): GitHubProjectConnection[] {
        return this.connections.filter(
            c => (
                c instanceof GitHubProjectConnection &&
                c.projectId === projectId
            )
        ) as GitHubProjectConnection[];
    }

    public getConnectionsForGitLabIssueWebhook(repoHome: string, issueId: number) {
        if (!this.config.gitlab) {
            throw Error('GitLab configuration missing, cannot handle note');
        }
        const res = GitLabClient.splitUrlIntoParts(this.config.gitlab.instances, repoHome);
        if (!res) {
            throw Error('No instance found for note');
        }
        const instance = this.config.gitlab.instances[res[0]];
        return this.getConnectionsForGitLabIssue(instance, res[1], issueId);
    }

    public getConnectionsForGitLabIssue(instance: GitLabInstance, projects: string[], issueNumber: number): GitLabIssueConnection[] {
        return this.connections.filter((c) => (
            c instanceof GitLabIssueConnection &&
            c.issueNumber == issueNumber &&
            c.instanceUrl == instance.url &&
            c.projectPath == projects.join("/")
        )) as GitLabIssueConnection[];
    }

    public getConnectionsForGitLabRepo(pathWithNamespace: string): GitLabRepoConnection[] {
        pathWithNamespace = pathWithNamespace.toLowerCase();
        return this.connections.filter((c) => (c instanceof GitLabRepoConnection && c.path === pathWithNamespace)) as GitLabRepoConnection[];
    }

    public getConnectionsForJiraProject(project: JiraProject): JiraProjectConnection[] {
        return this.connections.filter((c) => (c instanceof JiraProjectConnection && c.interestedInProject(project))) as JiraProjectConnection[];
    }

    public getConnectionsForJiraVersion(version: JiraVersion): JiraProjectConnection[] {
        return this.connections.filter((c) => (c instanceof JiraProjectConnection && c.interestedInVersion(version))) as JiraProjectConnection[];
    }

    public getConnectionsForGenericWebhook(hookId: string): GenericHookConnection[] {
        return this.connections.filter((c) => (c instanceof GenericHookConnection && c.hookId === hookId)) as GenericHookConnection[];
    }

    public getForFigmaFile(fileKey: string, instanceName: string): FigmaFileConnection[] {
        return this.connections.filter((c) => (c instanceof FigmaFileConnection && (c.fileId === fileKey || c.instanceName === instanceName))) as FigmaFileConnection[];
    }

    public getConnectionsForFeedUrl(url: string): FeedConnection[] {
        return this.connections.filter(c => c instanceof FeedConnection && c.feedUrl === url) as FeedConnection[];
    }
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public getAllConnectionsOfType<T extends IConnection>(typeT: new (...params : any[]) => T): T[] {
        return this.connections.filter((c) => (c instanceof typeT)) as T[];
    }

    public getAdminRoomByRoomId(roomId: string) {
        return this.adminRooms.get(roomId);
    }

    public getAdminRoomByUserId(userId: string) {
        for (const room of this.adminRooms.values()) {
            if (room.userId === userId) {
                return room;
            }
        }
        return undefined;
    }

    public isRoomConnected(roomId: string): boolean {
        return !!this.connections.find(c => c.roomId === roomId);
    }

    public getAllConnectionsForRoom(roomId: string): IConnection[] {
        return this.connections.filter(c => c.roomId === roomId).sort((a,b) => b.priority - a.priority);
    }

    public getInterestedForRoomState(roomId: string, eventType: string, stateKey: string): IConnection[] {
        return this.connections.filter(c => c.roomId === roomId && c.isInterestedInStateEvent(eventType, stateKey));
    }

    public getConnectionById(roomId: string, connectionId: string) {
        return this.connections.find((c) => c.connectionId === connectionId && c.roomId === roomId);
    }

    public validateCommandPrefix(roomId: string, config: IConnectionState, currentConnection?: IConnection) {
        if (config.commandPrefix === undefined) return;
        for (const c of this.getAllConnectionsForRoom(roomId)) {
            if (c != currentConnection && c.conflictsWithCommandPrefix?.(config.commandPrefix)) {
                throw new ApiError(`Command prefix "${config.commandPrefix}" is already used in this room. Please choose another prefix.`, ErrCode.ConflictingConnection, -1, {
                        existingConnection: c.getProvisionerDetails?.(),
                    }
                );
            }
        }
    }

    public async purgeConnection(roomId: string, connectionId: string, requireNoRemoveHandler = true) {
        const connection = this.connections.find((c) => c.connectionId === connectionId && c.roomId == roomId);
        if (!connection) {
            throw Error("Connection not found");
        }
        if (requireNoRemoveHandler && !connection.onRemove) {
            throw Error("Connection doesn't support removal, and so cannot be safely removed");
        }
        await connection.onRemove?.();
        const connectionIndex = this.connections.indexOf(connection);
        if (connectionIndex === -1) {
            throw Error('Could not find connection index');
        }
        this.connections.splice(connectionIndex, 1);
        Metrics.connections.set(this.connections.length);
        this.emit('connection-removed', connection);
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

    public registerProvisioningConnection(connType: {getProvisionerDetails: (botUserId: string) => GetConnectionTypeResponseItem}) {
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
    async getConnectionTargets(userId: string, type: string, filters: Record<string, unknown> = {}): Promise<unknown[]> {
        switch (type) {
        case GitLabRepoConnection.CanonicalEventType: {
            const configObject = this.validateConnectionTarget(userId, this.config.gitlab, "GitLab", "gitlab");
            return await GitLabRepoConnection.getConnectionTargets(userId, this.tokenStore, configObject, filters);
        }
        case GitHubRepoConnection.CanonicalEventType: {
            this.validateConnectionTarget(userId, this.config.github, "GitHub", "github");
            if (!this.github) {
                throw Error("GitHub instance was never initialized");
            }
            return await GitHubRepoConnection.getConnectionTargets(userId, this.tokenStore, this.github, filters);
        }
        case JiraProjectConnection.CanonicalEventType: {
            const configObject = this.validateConnectionTarget(userId, this.config.jira, "JIRA", "jira");
            return await JiraProjectConnection.getConnectionTargets(userId, this.tokenStore, configObject, filters);
        }
        default:
            throw new ApiError(`Connection type doesn't support getting targets or is not known`, ErrCode.NotFound);
        }
    }

    private validateConnectionTarget<T>(userId: string, configObject: T|undefined, serviceName: string, serviceId: string): T {
        if (!configObject) {
            throw new ApiError(`${serviceName} is not configured`, ErrCode.DisabledFeature);
        }
        if (!this.config.checkPermission(userId, serviceId, BridgePermissionLevel.manageConnections)) {
            throw new ApiError(`User is not permitted to provision connections for ${serviceName}`, ErrCode.ForbiddenUser);
        }
        return configObject;
    }
}
