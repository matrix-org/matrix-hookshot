import { Connection, IConnection, InstantiateConnectionOpts } from "./IConnection";
import { Appservice, Intent, StateEvent } from "matrix-bot-sdk";
import { UserTokenStore } from "../UserTokenStore";
import { CommentProcessor } from "../CommentProcessor";
import { MessageSenderClient } from "../MatrixSender";
import { getIntentForUser } from "../IntentUtils";
import { MatrixEvent, MatrixMessageContent } from "../MatrixEvent";
import { Discussion } from "@octokit/webhooks-types";
import emoji from "node-emoji";
import markdown from "markdown-it";
import { DiscussionCommentCreatedEvent } from "@octokit/webhooks-types";
import { GithubGraphQLClient } from "../Github/GithubInstance";
import { Logger } from "matrix-appservice-bridge";
import { BaseConnection } from "./BaseConnection";
import { BridgeConfigGitHub } from "../Config/Config";
export interface GitHubDiscussionConnectionState {
    owner: string;
    repo: string;
    id: number;
    internalId: string;
    discussion: number;
    category: number;
}

const log = new Logger("GitHubDiscussion");
const md = new markdown();

/**
 * Handles rooms connected to a GitHub discussion.
 */
@Connection
export class GitHubDiscussionConnection extends BaseConnection implements IConnection {
    static readonly CanonicalEventType = "uk.half-shot.matrix-hookshot.github.discussion";
    static readonly LegacyCanonicalEventType = "uk.half-shot.matrix-github.discussion";

    static readonly EventTypes = [
        GitHubDiscussionConnection.CanonicalEventType,
        GitHubDiscussionConnection.LegacyCanonicalEventType,
    ];

    static readonly QueryRoomRegex = /#github_disc_(.+)_(.+)_(\d+):.*/;
    static readonly ServiceCategory = "github";

    public static createConnectionForState(roomId: string, event: StateEvent<any>, {
        github, config, as, intent, tokenStore, commentProcessor, messageClient}: InstantiateConnectionOpts) {
        if (!github || !config.github) {
            throw Error('GitHub is not configured');
        }
        return new GitHubDiscussionConnection(
            roomId, as, intent, event.content, event.stateKey, tokenStore, commentProcessor,
            messageClient, config.github,
        );
    }

    readonly sentEvents = new Set<string>(); //TODO: Set some reasonable limits

    public static async createDiscussionRoom(
        as: Appservice, intent: Intent, userId: string|null, owner: string, repo: string, discussion: Discussion,
        tokenStore: UserTokenStore, commentProcessor: CommentProcessor, messageClient: MessageSenderClient,
        config: BridgeConfigGitHub,
    ) {
        const commentIntent = await getIntentForUser({
            login: discussion.user.login,
            avatarUrl: discussion.user.avatar_url,
        }, as, config.userIdPrefix);
        const state: GitHubDiscussionConnectionState = {
            owner,
            repo,
            id: discussion.id,
            internalId: discussion.node_id,
            discussion: discussion.number,
            category: discussion.category.id,
        };
        const invite = [intent.userId];
        if (userId) {
            invite.push(userId);
        }
        const roomId = await commentIntent.underlyingClient.createRoom({
            invite,
            preset: 'public_chat',
            name: `${discussion.title} (${owner}/${repo})`,
            topic: emoji.emojify(`Under ${discussion.category.emoji} ${discussion.category.name}`),
            room_alias_name: `github_disc_${owner.toLowerCase()}_${repo.toLowerCase()}_${discussion.number}`,
            initial_state: [{
                content: state,
                state_key: '',
                type: GitHubDiscussionConnection.CanonicalEventType,
            }],
        });
        await commentIntent.sendEvent(roomId, {
            msgtype: 'm.text',
            body: discussion.body,
            formatted_body: md.render(discussion.body),
            format: 'org.matrix.custom.html',
        });
        await intent.ensureJoined(roomId);
        return new GitHubDiscussionConnection(roomId, as, intent, state, '', tokenStore, commentProcessor, messageClient, config);
    }

    constructor(
        roomId: string,
        private readonly as: Appservice,
        private readonly intent: Intent,
        private readonly state: GitHubDiscussionConnectionState,
        stateKey: string,
        private readonly tokenStore: UserTokenStore,
        private readonly commentProcessor: CommentProcessor,
        private readonly messageClient: MessageSenderClient,
        private readonly config: BridgeConfigGitHub,
    ) {
        super(roomId, stateKey, GitHubDiscussionConnection.CanonicalEventType);
    }

    public isInterestedInStateEvent(eventType: string, stateKey: string) {
        return GitHubDiscussionConnection.EventTypes.includes(eventType) && this.stateKey === stateKey;
    }

    public async onMessageEvent(ev: MatrixEvent<MatrixMessageContent>) {
        const octokit = await this.tokenStore.getOctokitForUser(ev.sender);
        if (octokit === null) {
            // TODO: Use Reply - Also mention user.
            await this.intent.underlyingClient.sendNotice(this.roomId, `${ev.sender}: Cannot send comment, you are not logged into GitHub`);
            return true;
        }
        const qlClient = new GithubGraphQLClient(octokit);
        const commentId = await qlClient.addDiscussionComment(this.state.internalId, ev.content.body);
        log.info(`Sent ${commentId} for ${ev.event_id} (${ev.sender})`);
        this.sentEvents.add(commentId);
        return true;
    }

    public get discussionNumber() {
        return this.state.discussion;
    }

    public get repo() {
        return this.state.repo.toLowerCase();
    }

    public get owner() {
        return this.state.owner.toLowerCase();
    }

    public toString() {
        return `GitHubDiscussion ${this.owner}/${this.repo}#${this.state.discussion}`;
    }

    public async onDiscussionCommentCreated(data: DiscussionCommentCreatedEvent) {
        if (this.sentEvents.has(data.comment.node_id)) {
            return;
        }
        const intent = await getIntentForUser(data.comment.user, this.as, this.config.userIdPrefix);
        if (intent.userId !== this.intent.userId) {
            // Make sure ghost user is invited to the room
            await this.intent.underlyingClient.inviteUser(intent.userId, this.roomId);
        }
        await this.messageClient.sendMatrixMessage(this.roomId, {
            body: data.comment.body,
            formatted_body: md.render(data.comment.body),
            msgtype: 'm.text',
            external_url: data.comment.html_url,
            'uk.half-shot.matrix-hookshot.github.discussion.comment_id': data.comment.id,
        }, 'm.room.message', intent.userId);
    }

    public async onRemove() {
        log.info(`Removing ${this.toString()} for ${this.roomId}`);
        // Do a sanity check that the event exists.
        try {
            await this.intent.underlyingClient.getRoomStateEvent(this.roomId, GitHubDiscussionConnection.CanonicalEventType, this.stateKey);
            await this.intent.underlyingClient.sendStateEvent(this.roomId, GitHubDiscussionConnection.CanonicalEventType, this.stateKey, { disabled: true });
        } catch (ex) {
            await this.intent.underlyingClient.getRoomStateEvent(this.roomId, GitHubDiscussionConnection.LegacyCanonicalEventType, this.stateKey);
            await this.intent.underlyingClient.sendStateEvent(this.roomId, GitHubDiscussionConnection.LegacyCanonicalEventType, this.stateKey, { disabled: true });
        }
    }
}
