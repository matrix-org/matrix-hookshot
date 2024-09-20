import { Connection, IConnection, InstantiateConnectionOpts } from "./IConnection";
import { Appservice, Intent, StateEvent } from "matrix-bot-sdk";
import { MatrixMessageContent, MatrixEvent } from "../MatrixEvent";
import { UserTokenStore } from "../tokens/UserTokenStore";
import { Logger } from "matrix-appservice-bridge";
import { CommentProcessor } from "../CommentProcessor";
import { MessageSenderClient } from "../MatrixSender";
import { BridgeConfig, BridgeConfigGitLab, GitLabInstance } from "../config/Config";
import { GetIssueResponse } from "../Gitlab/Types";
import { IGitLabWebhookNoteEvent } from "../Gitlab/WebhookTypes";
import { ensureUserIsInRoom, getIntentForUser } from "../IntentUtils";
import { BaseConnection } from "./BaseConnection";
import { ConfigGrantChecker, GrantChecker } from "../grants/GrantCheck";

export interface GitLabIssueConnectionState {
    instance: string;
    projects: string[];
    state: string;
    iid: number;
    id: number;
    authorName: string;
}

const log = new Logger("GitLabIssueConnection");

// interface IQueryRoomOpts {
//     as: Appservice;
//     tokenStore: UserTokenStore;
//     commentProcessor: CommentProcessor;
//     messageClient: MessageSenderClient;
//     octokit: Octokit;
// }

/**
 * Handles rooms connected to a GitLab issue.
 */
@Connection
export class GitLabIssueConnection extends BaseConnection implements IConnection {
    static readonly CanonicalEventType = "uk.half-shot.matrix-hookshot.gitlab.issue";
    static readonly LegacyCanonicalEventType = "uk.half-shot.matrix-github.gitlab.issue";
    static readonly EventTypes = [
        GitLabIssueConnection.CanonicalEventType,
        GitLabIssueConnection.LegacyCanonicalEventType,
    ];
    static readonly QueryRoomRegex = /#gitlab_(.+)_(.+)_(\d+):.*/;
    static readonly ServiceCategory = "gitlab";

    static getTopicString(authorName: string, state: string): string {
        return `Author: ${authorName} | State: ${state === "closed" ? "closed" : "open"}`
    }

    public static async createConnectionForState(
        roomId: string,
        event: StateEvent<any>,
        { config, as, intent, tokenStore, commentProcessor, messageClient}: InstantiateConnectionOpts,
    ) {
        if (!config.gitlab) {
            throw Error('GitHub is not configured');
        }
        const instance = config.gitlab.instances[event.content.instance];
        if (!instance) {
            throw Error('Instance name not recognised');
        }
        return new GitLabIssueConnection(
            roomId,
            as,
            intent,
            event.content,
            event.stateKey || "",
            tokenStore,
            commentProcessor,
            messageClient,
            instance,
            config,
        );
    }

    public static async createRoomForIssue(
        instanceName: string,
        instance: GitLabInstance,
        issue: GetIssueResponse,
        projects: string[],
        as: Appservice,
        intent: Intent,
        tokenStore: UserTokenStore,
        commentProcessor: CommentProcessor,
        messageSender: MessageSenderClient,
        config: BridgeConfig,
    ) {
        const state: GitLabIssueConnectionState = {
            projects,
            state: issue.state,
            iid: issue.iid,
            id: issue.id,
            instance: instanceName,
            authorName: issue.author.name,
        };

        const roomId = await intent.underlyingClient.createRoom({
            visibility: "private",
            name: `${issue.references.full}`,
            topic: GitLabIssueConnection.getTopicString(issue.author.name, issue.state),
            preset: "private_chat",
            invite: [],
            initial_state: [
                {
                    type: this.CanonicalEventType,
                    content: state,
                    state_key: issue.web_url,
                },
            ],
        });
        await new GrantChecker(as.botIntent, "gitlab").grantConnection(roomId, {
            instance: state.instance,
            project: state.projects[0].toString(),
            issue: state.iid.toString(),
        });

        return new GitLabIssueConnection(roomId, as, intent, state, issue.web_url, tokenStore, commentProcessor, messageSender, instance, config);
    }

    public get projectPath() {
        return this.state.projects.join("/");
    }

    public get instanceUrl() {
        return this.instance.url;
    }

    private readonly grantChecker: GrantChecker<{instance: string, project: string, issue: string}>;
    private readonly config: BridgeConfigGitLab;

    constructor(
        roomId: string,
        private readonly as: Appservice,
        private readonly intent: Intent,
        private state: GitLabIssueConnectionState,
        stateKey: string,
        private tokenStore: UserTokenStore,
        private commentProcessor: CommentProcessor,
        private messageClient: MessageSenderClient,
        private instance: GitLabInstance,
        config: BridgeConfig,
    ) {
        super(roomId, stateKey, GitLabIssueConnection.CanonicalEventType);
        this.grantChecker = new ConfigGrantChecker("gitlab", as, config);
        if (!config.gitlab) {
            throw Error('No gitlab config!');
        }
        this.config = config.gitlab;
    }

    public ensureGrant(sender?: string) {
        return this.grantChecker.assertConnectionGranted(this.roomId, {
            instance: this.state.instance,
            project: this.state.projects[0],
            issue: this.state.iid.toString(),
        }, sender);
    }

    public isInterestedInStateEvent(eventType: string, stateKey: string) {
        return GitLabIssueConnection.EventTypes.includes(eventType) && this.stateKey === stateKey;
    }

    public get issueNumber() {
        return this.state.iid;
    }

    public async onCommentCreated(event: IGitLabWebhookNoteEvent) {
        log.info(`${this.toString()} onCommentCreated ${event.object_attributes.noteable_id}`);
        if (event.repository) {
            // Delay to stop comments racing sends
            await new Promise((resolve) => setTimeout(resolve, 500));
            if (this.commentProcessor.hasCommentBeenProcessed(
                this.state.instance,
                this.state.projects.join("/"),
                this.state.iid.toString(),
                event.object_attributes.id)) {
                return;
            }
        }
        const commentIntent = await getIntentForUser({
            login: event.user.name,
            avatarUrl: event.user.avatar_url,
        }, this.as, this.config.userIdPrefix);
        const matrixEvent = await this.commentProcessor.getEventBodyForGitLabNote(event);
        // Make sure ghost user is invited to the room
        await ensureUserIsInRoom(
            commentIntent,
            this.intent.underlyingClient,
            this.roomId
        );
        await this.messageClient.sendMatrixMessage(this.roomId, matrixEvent, "m.room.message", commentIntent.userId);
    }

    public async onMatrixIssueComment(event: MatrixEvent<MatrixMessageContent>, allowEcho = false) {
        const clientKit = await this.tokenStore.getGitLabForUser(event.sender, this.instanceUrl);
        if (clientKit === null) {
            await this.intent.underlyingClient.sendEvent(this.roomId, "m.reaction", {
                "m.relates_to": {
                    rel_type: "m.annotation",
                    event_id: event.event_id,
                    key: "⚠️ Not bridged",
                }
            })
            log.info("Ignoring comment, user is not authenticated");
            return;
        }
        const result = await clientKit.notes.createForIssue(
            this.state.projects,
            this.state.iid, {
                body: await this.commentProcessor.getCommentBodyForEvent(event, false),
            }
        );
        log.info(`${this.toString()} created note ${result.noteable_id} for ${event.event_id} ${event.sender}`);

        if (!allowEcho) {
            this.commentProcessor.markCommentAsProcessed(
                this.state.instance,
                this.state.projects.join("/"),
                this.state.iid.toString(),
                result.id,
            );
        }
    }

    public async onIssueReopened() {
        // TODO: We don't store the author data.
        this.state.state = "reopened";
        await this.intent.underlyingClient.sendStateEvent(this.roomId, GitLabIssueConnection.CanonicalEventType, this.stateKey, this.state);
        return this.intent.underlyingClient.sendStateEvent(this.roomId, "m.room.topic", "", {
            topic: GitLabIssueConnection.getTopicString(this.state.authorName, this.state.state),
        });
    }

    public async onIssueClosed() {
        // TODO: We don't store the author data.
        this.state.state = "closed";
        await this.intent.underlyingClient.sendStateEvent(this.roomId, GitLabIssueConnection.CanonicalEventType, this.stateKey , this.state);
        return this.intent.underlyingClient.sendStateEvent(this.roomId, "m.room.topic", "", {
            topic: GitLabIssueConnection.getTopicString(this.state.authorName, this.state.state),
        });
    }

    public async onMessageEvent(ev: MatrixEvent<MatrixMessageContent>) {
        if (ev.content.body === '!sync') {
            // Sync data.
           // return this.syncIssueState();
           return true;
        }
        await this.onMatrixIssueComment(ev);
        return true;
    }

    public toString() {
        return `GitLabIssue ${this.instanceUrl}/${this.projectPath}#${this.issueNumber}`;
    }
}
