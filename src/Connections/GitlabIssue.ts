import { Connection, IConnection, InstantiateConnectionOpts } from "./IConnection";
import { Appservice, StateEvent } from "matrix-bot-sdk";
import { MatrixMessageContent, MatrixEvent } from "../MatrixEvent";
import { UserTokenStore } from "../UserTokenStore";
import LogWrapper from "../LogWrapper";
import { CommentProcessor } from "../CommentProcessor";
import { MessageSenderClient } from "../MatrixSender";
import { BridgeConfigGitLab, GitLabInstance } from "../Config/Config";
import { GetIssueResponse } from "../Gitlab/Types";
import { IGitLabWebhookNoteEvent } from "../Gitlab/WebhookTypes";
import { getIntentForUser } from "../IntentUtils";
import { BaseConnection } from "./BaseConnection";

export interface GitLabIssueConnectionState {
    instance: string;
    projects: string[];
    state: string;
    iid: number;
    id: number;
    authorName: string;
}

const log = new LogWrapper("GitLabIssueConnection");

// interface IQueryRoomOpts {
//     as: Appservice;
//     tokenStore: UserTokenStore;
//     commentProcessor: CommentProcessor;
//     messageClient: MessageSenderClient;
//     octokit: Octokit;
// }

/**
 * Handles rooms connected to a github repo.
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

    public static async createConnectionForState(roomId: string, event: StateEvent<any>, {
        config, as, tokenStore, commentProcessor, messageClient}: InstantiateConnectionOpts) {
        if (!config.gitlab) {
            throw Error('GitHub is not configured');
        }
        const instance = config.gitlab.instances[event.content.instance];
        if (!instance) {
            throw Error('Instance name not recognised');
        }
        return new GitLabIssueConnection(
            roomId, as, event.content, event.stateKey || "", tokenStore,
            commentProcessor, messageClient, instance, config.gitlab,
        );
    }

    public static async createRoomForIssue(instanceName: string, instance: GitLabInstance,
        issue: GetIssueResponse, projects: string[], as: Appservice,
        tokenStore: UserTokenStore, commentProcessor: CommentProcessor, 
        messageSender: MessageSenderClient, config: BridgeConfigGitLab) {
        const state: GitLabIssueConnectionState = {
            projects,
            state: issue.state,
            iid: issue.iid,
            id: issue.id,
            instance: instanceName,
            authorName: issue.author.name,
        };

        const roomId = await as.botClient.createRoom({
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

        return new GitLabIssueConnection(roomId, as, state, issue.web_url, tokenStore, commentProcessor, messageSender, instance, config);
    }

    public get projectPath() {
        return this.state.projects.join("/");
    }

    public get instanceUrl() {
        return this.instance.url;
    }

    constructor(roomId: string,
        private readonly as: Appservice,
        private state: GitLabIssueConnectionState,
        stateKey: string,
        private tokenStore: UserTokenStore,
        private commentProcessor: CommentProcessor,
        private messageClient: MessageSenderClient,
        private instance: GitLabInstance,
        private config: BridgeConfigGitLab) {
            super(roomId, stateKey, GitLabIssueConnection.CanonicalEventType);
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

        await this.messageClient.sendMatrixMessage(this.roomId, matrixEvent, "m.room.message", commentIntent.userId);
    }

    public async onMatrixIssueComment(event: MatrixEvent<MatrixMessageContent>, allowEcho = false) {
        const clientKit = await this.tokenStore.getGitLabForUser(event.sender, this.instanceUrl);
        if (clientKit === null) {
            await this.as.botClient.sendEvent(this.roomId, "m.reaction", {
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
        await this.as.botClient.sendStateEvent(this.roomId, GitLabIssueConnection.CanonicalEventType, this.stateKey, this.state);
        return this.as.botClient.sendStateEvent(this.roomId, "m.room.topic", "", {
            topic: GitLabIssueConnection.getTopicString(this.state.authorName, this.state.state),
        });
    }

    public async onIssueClosed() {
        // TODO: We don't store the author data.
        this.state.state = "closed";
        await this.as.botClient.sendStateEvent(this.roomId, GitLabIssueConnection.CanonicalEventType, this.stateKey , this.state);
        return this.as.botClient.sendStateEvent(this.roomId, "m.room.topic", "", {
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