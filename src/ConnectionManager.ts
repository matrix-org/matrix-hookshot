

/**
 * Manages connections between Matrix rooms and the remote side.
 */

import { Appservice, StateEvent } from "matrix-bot-sdk";
import { CommentProcessor } from "./CommentProcessor";
import { BridgeConfig, GitLabInstance } from "./Config/Config";
import { GitHubDiscussionConnection, GitHubDiscussionSpace, GitHubIssueConnection, GitHubProjectConnection, GitHubRepoConnection, GitHubUserSpace, GitLabIssueConnection, GitLabRepoConnection, IConnection } from "./Connections";
import { GenericHookConnection } from "./Connections/GenericHook";
import { JiraProjectConnection } from "./Connections/JiraProject";
import { GithubInstance } from "./Github/GithubInstance";
import { GitLabClient } from "./Gitlab/Client";
import { JiraProject } from "./Jira/Types";
import LogWrapper from "./LogWrapper";
import { MessageSenderClient } from "./MatrixSender";
import { UserTokenStore } from "./UserTokenStore";

const log = new LogWrapper("ConnectionManager");

export class ConnectionManager {
    private connections: IConnection[] = [];

    constructor(
        private readonly as: Appservice,
        private readonly config: BridgeConfig,
        private readonly tokenStore: UserTokenStore,
        private readonly commentProcessor: CommentProcessor,
        private readonly messageClient: MessageSenderClient,
        private readonly github?: GithubInstance) {

    }

    /**
     * Push a new connection to the manager, if this connection already
     * exists then this will no-op.
     * NOTE: The comparison only checks that the same object instance isn't present,
     * but not if two instances exist with the same type/state.
     * @param connection The connection instance to push.
     */
    public push(...connections: IConnection[]) {
        // NOTE: Double loop
        for (const connection of connections) {
            if (!this.connections.find((c) => c === connection)) {
                this.connections.push(connection);
            }
        }
        // Already exists, noop.
    }

    public async createConnectionForState(roomId: string, state: StateEvent<any>) {
        log.debug(`Looking to create connection for ${roomId} ${state.type}`);
        if (state.content.disabled === true) {
            log.debug(`${roomId} has disabled state for ${state.type}`);
            return;
        }

        if (GitHubRepoConnection.EventTypes.includes(state.type)) {
            if (!this.github || !this.config.github) {
                throw Error('GitHub is not configured');
            }
            return new GitHubRepoConnection(roomId, this.as, state.content, this.tokenStore, state.stateKey, this.github, this.config.github);
        }

        if (GitHubDiscussionConnection.EventTypes.includes(state.type)) {
            if (!this.github) {
                throw Error('GitHub is not configured');
            }
            return new GitHubDiscussionConnection(
                roomId, this.as, state.content, state.stateKey, this.tokenStore, this.commentProcessor,
                this.messageClient,
            );
        }
    
        if (GitHubDiscussionSpace.EventTypes.includes(state.type)) {
            if (!this.github) {
                throw Error('GitHub is not configured');
            }

            return new GitHubDiscussionSpace(
                await this.as.botClient.getSpace(roomId), state.content, state.stateKey
            );
        }

        if (GitHubIssueConnection.EventTypes.includes(state.type)) {
            if (!this.github) {
                throw Error('GitHub is not configured');
            }
            const issue = new GitHubIssueConnection(roomId, this.as, state.content, state.stateKey || "", this.tokenStore, this.commentProcessor, this.messageClient, this.github);
            await issue.syncIssueState();
            return issue;
        }

        if (GitHubUserSpace.EventTypes.includes(state.type)) {
            if (!this.github) {
                throw Error('GitHub is not configured');
            }
            return new GitHubUserSpace(
                await this.as.botClient.getSpace(roomId), state.content, state.stateKey
            );
        }
        
        if (GitLabRepoConnection.EventTypes.includes(state.type)) {
            if (!this.config.gitlab) {
                throw Error('GitLab is not configured');
            }
            const instance = this.config.gitlab.instances[state.content.instance];
            if (!instance) {
                throw Error('Instance name not recognised');
            }
            return new GitLabRepoConnection(roomId, this.as, state.content, state.stateKey, this.tokenStore, instance);
        }

        if (GitLabIssueConnection.EventTypes.includes(state.type)) {
            if (!this.config.gitlab) {
                throw Error('GitLab is not configured');
            }
            const instance = this.config.gitlab.instances[state.content.instance];
            return new GitLabIssueConnection(
                roomId,
                this.as,
                state.content,
                state.stateKey as string, 
                this.tokenStore,
                this.commentProcessor,
                this.messageClient,
                instance);
        }

        if (JiraProjectConnection.EventTypes.includes(state.type)) {
            if (!this.config.jira) {
                throw Error('JIRA is not configured');
            }
            return new JiraProjectConnection(roomId, this.as, state.content, state.stateKey, this.commentProcessor, this.messageClient, this.tokenStore);
        }

        if (GenericHookConnection.EventTypes.includes(state.type) && this.config.generic?.enabled) {
            return new GenericHookConnection(
                roomId,
                state.content,
                state.stateKey,
                this.messageClient,
                this.config.generic.allowJsTransformationFunctions
            );
        }
        return;
    }

    public async createConnectionsForRoomId(roomId: string): Promise<IConnection[]> {
        const state = await this.as.botClient.getRoomState(roomId);
        const connections: IConnection[] = [];
        for (const event of state) {
            const conn = await this.createConnectionForState(roomId, new StateEvent(event));
            if (conn) { connections.push(conn); }
        }
        return connections;
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
        console.log(this.connections);
        return this.connections.filter((c) => 
            (c instanceof JiraProjectConnection &&
                c.interestedInProject(project) &&
                c.isInterestedInHookEvent(eventName))) as JiraProjectConnection[];
    }


    public getConnectionsForGenericWebhook(hookId: string): GenericHookConnection[] {
        return this.connections.filter((c) => (c instanceof GenericHookConnection && c.hookId === hookId)) as GenericHookConnection[];
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public getAllConnectionsOfType<T extends IConnection>(typeT: new (...params : any[]) => T): T[] {
        return this.connections.filter((c) => (c instanceof typeT)) as T[];
    }

    public isRoomConnected(roomId: string): boolean {
        return !!this.connections.find(c => c.roomId === roomId);
    }

    public getAllConnectionsForRoom(roomId: string): IConnection[] {
        return this.connections.filter(c => c.roomId === roomId);
    }

    public getInterestedForRoomState(roomId: string, eventType: string, stateKey: string): IConnection[] {
        return this.connections.filter(c => c.roomId === roomId && c.isInterestedInStateEvent(eventType, stateKey));
    }
}