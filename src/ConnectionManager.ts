

/**
 * Manages connections between Matrix rooms and the remote side.
 */

import { Appservice, StateEvent } from "matrix-bot-sdk";
import { CommentProcessor } from "./CommentProcessor";
import { BridgeConfig, BridgePermissionLevel, GitLabInstance } from "./Config/Config";
import { GenericHookConnection, GitHubDiscussionConnection, GitHubDiscussionSpace, GitHubIssueConnection, GitHubProjectConnection, GitHubRepoConnection, GitHubUserSpace, GitLabIssueConnection, GitLabRepoConnection, IConnection, JiraProjectConnection } from "./Connections";
import { GenericHookAccountData } from "./Connections/GenericHook";
import { GithubInstance } from "./Github/GithubInstance";
import { GitLabClient } from "./Gitlab/Client";
import { JiraProject } from "./Jira/Types";
import LogWrapper from "./LogWrapper";
import { MessageSenderClient } from "./MatrixSender";
import { GetConnectionTypeResponseItem } from "./provisioning/api";
import { ApiError, ErrCode } from "./api";
import { UserTokenStore } from "./UserTokenStore";
import {v4 as uuid} from "uuid";
import { FigmaFileConnection, FeedConnection } from "./Connections";
import { IBridgeStorageProvider } from "./Stores/StorageProvider";
import Metrics from "./Metrics";
import EventEmitter from "events";

const log = new LogWrapper("ConnectionManager");

export class ConnectionManager extends EventEmitter {
    private connections: IConnection[] = [];
    public readonly enabledForProvisioning: Record<string, GetConnectionTypeResponseItem> = {};

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
        private readonly github?: GithubInstance
    ) {
        super();
    }

    /**
     * Push a new connection to the manager, if this connection already
     * exists then this will no-op.
     * NOTE: The comparison only checks that the same object instance isn't present,
     * but not if two instances exist with the same type/state.
     * @param connection The connection instance to push.
     */
    public push(...connections: IConnection[]) {
        for (const connection of connections) {
            if (!this.connections.find(c => c.connectionId === connection.connectionId)) {
                this.connections.push(connection);
                this.emit('new-connection', connection);
            }
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
    public async provisionConnection(roomId: string, userId: string, type: string, data: Record<string, unknown>): Promise<IConnection> {
        log.info(`Looking to provision connection for ${roomId} ${type} for ${userId} with ${data}`);
        const existingConnections = await this.getAllConnectionsForRoom(roomId);
        if (JiraProjectConnection.EventTypes.includes(type)) {
            if (!this.config.jira) {
                throw new ApiError('JIRA integration is not configured', ErrCode.DisabledFeature);
            }
            if (existingConnections.find(c => c instanceof JiraProjectConnection)) {
                // TODO: Support this.
                throw Error("Cannot support multiple connections of the same type yet");
            }
            if (!this.config.checkPermission(userId, "jira", BridgePermissionLevel.manageConnections)) {
                throw new ApiError('User is not permitted to provision connections for Jira', ErrCode.ForbiddenUser);
            }
            const res = await JiraProjectConnection.provisionConnection(roomId, userId, data, this.as, this.tokenStore);
            await this.as.botIntent.underlyingClient.sendStateEvent(roomId, JiraProjectConnection.CanonicalEventType, res.connection.stateKey, res.stateEventContent);
            this.push(res.connection);
            return res.connection;
        }
        if (GitHubRepoConnection.EventTypes.includes(type)) {
            if (!this.config.github || !this.config.github.oauth || !this.github) {
                throw new ApiError('GitHub integration is not configured', ErrCode.DisabledFeature);
            }
            if (existingConnections.find(c => c instanceof GitHubRepoConnection)) {
                // TODO: Support this.
                throw Error("Cannot support multiple connections of the same type yet");
            }
            if (!this.config.checkPermission(userId, "github", BridgePermissionLevel.manageConnections)) {
                throw new ApiError('User is not permitted to provision connections for GitHub', ErrCode.ForbiddenUser);
            }
            const res = await GitHubRepoConnection.provisionConnection(roomId, userId, data, this.as, this.tokenStore, this.github, this.config.github);
            await this.as.botIntent.underlyingClient.sendStateEvent(roomId, GitHubRepoConnection.CanonicalEventType, res.connection.stateKey, res.stateEventContent);
            this.push(res.connection);
            return res.connection;
        }
        if (GenericHookConnection.EventTypes.includes(type)) {
            if (!this.config.generic) {
                throw new ApiError('Generic Webhook integration is not configured', ErrCode.DisabledFeature);
            }
            if (!this.config.checkPermission(userId, "webhooks", BridgePermissionLevel.manageConnections)) {
                throw new ApiError('User is not permitted to provision connections for generic webhooks', ErrCode.ForbiddenUser);
            }
            const res = await GenericHookConnection.provisionConnection(roomId, this.as, data, this.config.generic, this.messageClient);
            const existing = this.getAllConnectionsOfType(GenericHookConnection).find(c => c.stateKey === res.connection.stateKey);
            if (existing) {
                throw new ApiError("A generic webhook with this name already exists", ErrCode.ConflictingConnection, -1, {
                    existingConnection: existing.getProvisionerDetails()
                });
            }
            await GenericHookConnection.ensureRoomAccountData(roomId, this.as, res.connection.hookId, res.connection.stateKey);
            await this.as.botIntent.underlyingClient.sendStateEvent(roomId, GenericHookConnection.CanonicalEventType, res.connection.stateKey, res.stateEventContent);
            this.push(res.connection);
            return res.connection;
        }
        if (GitLabRepoConnection.EventTypes.includes(type)) {
            if (!this.config.gitlab) {
                throw new ApiError('GitLab integration is not configured', ErrCode.DisabledFeature);
            }
            if (!this.config.checkPermission(userId, "gitlab", BridgePermissionLevel.manageConnections)) {
                throw new ApiError('User is not permitted to provision connections for GitLab', ErrCode.ForbiddenUser);
            }
            const res = await GitLabRepoConnection.provisionConnection(roomId, userId, data, this.as, this.tokenStore, data.instance as string, this.config.gitlab);
            const existing = this.getAllConnectionsOfType(GitLabRepoConnection).find(c => c.stateKey === res.connection.stateKey);
            if (existing) {
                throw new ApiError("A GitLab repo connection for this project already exists", ErrCode.ConflictingConnection, -1, {
                    existingConnection: existing.getProvisionerDetails()
                });
            }
            await this.as.botIntent.underlyingClient.sendStateEvent(roomId, GitLabRepoConnection.CanonicalEventType, res.connection.stateKey, res.stateEventContent);
            this.push(res.connection);
            return res.connection;
        }
        throw new ApiError(`Connection type not known`);
    }

    private assertStateAllowed(state: StateEvent<any>, serviceType: "github"|"gitlab"|"jira"|"figma"|"webhooks"|"feed") {
        if (state.sender === this.as.botUserId) {
            return;
        }
        if (!this.config.checkPermission(state.sender, serviceType, BridgePermissionLevel.manageConnections)) {
            throw new Error(`User ${state.sender} is disallowed to create state for ${serviceType}`);
        }
    }

    public async createConnectionForState(roomId: string, state: StateEvent<any>) {
        // Empty object == redacted
        if (state.content.disabled === true || Object.keys(state.content).length === 0) {
            log.debug(`${roomId} has disabled state for ${state.type}`);
            return;
        }


        if (GitHubRepoConnection.EventTypes.includes(state.type)) {
            if (!this.github || !this.config.github) {
                throw Error('GitHub is not configured');
            }
            this.assertStateAllowed(state, "github");
            return new GitHubRepoConnection(roomId, this.as, state.content, this.tokenStore, state.stateKey, this.github, this.config.github);
        }

        if (GitHubDiscussionConnection.EventTypes.includes(state.type)) {
            if (!this.github || !this.config.github) {
                throw Error('GitHub is not configured');
            }
            this.assertStateAllowed(state, "github");
            return new GitHubDiscussionConnection(
                roomId, this.as, state.content, state.stateKey, this.tokenStore, this.commentProcessor,
                this.messageClient, this.config.github,
            );
        }
    
        if (GitHubDiscussionSpace.EventTypes.includes(state.type)) {
            if (!this.github) {
                throw Error('GitHub is not configured');
            }
            this.assertStateAllowed(state, "github");

            return new GitHubDiscussionSpace(
                await this.as.botClient.getSpace(roomId), state.content, state.stateKey
            );
        }

        if (GitHubIssueConnection.EventTypes.includes(state.type)) {
            if (!this.github || !this.config.github) {
                throw Error('GitHub is not configured');
            }
            
            this.assertStateAllowed(state, "github");
            const issue = new GitHubIssueConnection(
                roomId, this.as, state.content, state.stateKey || "", this.tokenStore,
                this.commentProcessor, this.messageClient, this.github, this.config.github,
            );
            await issue.syncIssueState();
            return issue;
        }

        if (GitHubUserSpace.EventTypes.includes(state.type)) {
            if (!this.github) {
                throw Error('GitHub is not configured');
            }

            this.assertStateAllowed(state, "github");
            return new GitHubUserSpace(
                await this.as.botClient.getSpace(roomId), state.content, state.stateKey
            );
        }
        
        if (GitLabRepoConnection.EventTypes.includes(state.type)) {
            if (!this.config.gitlab) {
                throw Error('GitLab is not configured');
            }
            
            this.assertStateAllowed(state, "gitlab");
            const instance = this.config.gitlab.instances[state.content.instance];
            if (!instance) {
                throw Error('Instance name not recognised');
            }
            return new GitLabRepoConnection(roomId, state.stateKey, this.as, state.content, this.tokenStore, instance);
        }

        if (GitLabIssueConnection.EventTypes.includes(state.type)) {
            if (!this.github || !this.config.gitlab) {
                throw Error('GitLab is not configured');
            }
            this.assertStateAllowed(state, "gitlab");
            const instance = this.config.gitlab.instances[state.content.instance];
            return new GitLabIssueConnection(
                roomId,
                this.as,
                state.content,
                state.stateKey as string, 
                this.tokenStore,
                this.commentProcessor,
                this.messageClient,
                instance,
                this.config.gitlab,
            );
        }

        if (JiraProjectConnection.EventTypes.includes(state.type)) {
            if (!this.config.jira) {
                throw Error('JIRA is not configured');
            }
            this.assertStateAllowed(state, "jira");
            return new JiraProjectConnection(roomId, this.as, state.content, state.stateKey, this.tokenStore);
        }

        if (FigmaFileConnection.EventTypes.includes(state.type)) {
            if (!this.config.figma) {
                throw Error('Figma is not configured');
            }
            this.assertStateAllowed(state, "figma");
            return new FigmaFileConnection(roomId, state.stateKey, state.content, this.config.figma, this.as, this.storage);
        }

        if (FeedConnection.EventTypes.includes(state.type)) {
            if (!this.config.feeds?.enabled) {
                throw Error('RSS/Atom feeds are not configured');
            }
            this.assertStateAllowed(state, "feed");
            return new FeedConnection(roomId, state.stateKey, state.content, this.config.feeds, this.as, this.storage);
        }

        if (GenericHookConnection.EventTypes.includes(state.type) && this.config.generic?.enabled) {
            if (!this.config.generic) {
                throw Error('Generic webhooks are not configured');
            }
            this.assertStateAllowed(state, "webhooks");
            // Generic hooks store the hookId in the account data
            const acctData = await this.as.botClient.getSafeRoomAccountData<GenericHookAccountData>(GenericHookConnection.CanonicalEventType, roomId, {});
            // hookId => stateKey
            let hookId = Object.entries(acctData).find(([, v]) => v === state.stateKey)?.[0];
            if (!hookId) {
                hookId = uuid();
                log.warn(`hookId for ${roomId} not set in accountData, setting to ${hookId}`);
                await GenericHookConnection.ensureRoomAccountData(roomId, this.as, hookId, state.stateKey);
            }

            return new GenericHookConnection(
                roomId,
                state.content,
                hookId,
                state.stateKey,
                this.messageClient,
                this.config.generic,
                this.as,
            );
        }
        return;
    }

    public async createConnectionsForRoomId(roomId: string) {
        const state = await this.as.botClient.getRoomState(roomId);
        for (const event of state) {
            try {
                const conn = await this.createConnectionForState(roomId, new StateEvent(event));
                if (conn) {
                    log.debug(`Room ${roomId} is connected to: ${conn}`);
                    this.push(conn);
                }
            } catch (ex) {
                log.error(`Failed to create connection for ${roomId}:`, ex);
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

    public getConnectionsForJiraProject(project: JiraProject, eventName: string): JiraProjectConnection[] {
        return this.connections.filter((c) => 
            (c instanceof JiraProjectConnection &&
                c.interestedInProject(project) &&
                c.isInterestedInHookEvent(eventName))) as JiraProjectConnection[];
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
     * @param arg1 
     */
    async getConnectionTargets(userId: string, type: string, filters: Record<string, unknown> = {}): Promise<unknown[]> {
        if (type === GitLabRepoConnection.CanonicalEventType) {
            if (!this.config.gitlab) {
                throw new ApiError('GitLab is not configured', ErrCode.DisabledFeature);
            }
            if (!this.config.checkPermission(userId, "gitlab", BridgePermissionLevel.manageConnections)) {
                throw new ApiError('User is not permitted to provision connections for GitLab', ErrCode.ForbiddenUser);
            }
            return await GitLabRepoConnection.getConnectionTargets(userId, this.tokenStore, this.config.gitlab, filters);
        }
        throw new ApiError(`Connection type not known`, ErrCode.NotFound);
    }
}
