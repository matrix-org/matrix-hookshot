import { Connection, IConnection, InstantiateConnectionOpts } from "./IConnection";
import { Appservice, Intent, StateEvent } from "matrix-bot-sdk";
import { UserTokenStore } from "../tokens/UserTokenStore";
import { CommentProcessor } from "../CommentProcessor";
import { MessageSenderClient } from "../MatrixSender";
import { ensureUserIsInRoom, getIntentForUser } from "../IntentUtils";
import { MatrixEvent, MatrixMessageContent } from "../MatrixEvent";
import { Discussion } from "@octokit/webhooks-types";
import emoji from "node-emoji";
import markdown from "markdown-it";
import { DiscussionCommentCreatedEvent } from "@octokit/webhooks-types";
import { GithubGraphQLClient } from "../github/GithubInstance";
import { Logger } from "matrix-appservice-bridge";
import { BaseConnection } from "./BaseConnection";
import { BridgeConfig, BridgeConfigGitHub } from "../config/Config";
import { ConfigGrantChecker, GrantChecker } from "../grants/GrantCheck";
import QuickLRU from "@alloc/quick-lru";
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
            messageClient, config,
        );
    }


    public static async createDiscussionRoom(
        as: Appservice, intent: Intent, userId: string|null, owner: string, repo: string, discussion: Discussion,
        tokenStore: UserTokenStore, commentProcessor: CommentProcessor, messageClient: MessageSenderClient,
        config: BridgeConfig,
    ) {
        const commentIntent = await getIntentForUser({
            login: discussion.user.login,
            avatarUrl: discussion.user.avatar_url,
        }, as, config.github?.userIdPrefix);
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

    private static grantKey(state: GitHubDiscussionConnectionState) {
        return `${this.CanonicalEventType}/${state.owner}/${state.repo}`;
    }

    private readonly sentEvents = new QuickLRU<string, undefined>({ maxSize: 128 });
    private readonly grantChecker: GrantChecker;

    private readonly config: BridgeConfigGitHub;

    constructor(
        roomId: string,
        private readonly as: Appservice,
        private readonly intent: Intent,
        private readonly state: GitHubDiscussionConnectionState,
        stateKey: string,
        private readonly tokenStore: UserTokenStore,
        private readonly commentProcessor: CommentProcessor,
        private readonly messageClient: MessageSenderClient,
        bridgeConfig: BridgeConfig,
    ) {
        super(roomId, stateKey, GitHubDiscussionConnection.CanonicalEventType);
        if (!bridgeConfig.github) {
            throw Error('Expected github to be enabled in config');
        }
        this.config = bridgeConfig.github;
        this.grantChecker = new ConfigGrantChecker("github", this.as, bridgeConfig);
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
        this.sentEvents.set(commentId, undefined);
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
        await ensureUserIsInRoom(intent, this.intent.underlyingClient, this.roomId);
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
        await this.grantChecker.ungrantConnection(this.roomId, GitHubDiscussionConnection.grantKey(this.state));
        // Do a sanity check that the event exists.
        try {
            await this.intent.underlyingClient.getRoomStateEvent(this.roomId, GitHubDiscussionConnection.CanonicalEventType, this.stateKey);
            await this.intent.underlyingClient.sendStateEvent(this.roomId, GitHubDiscussionConnection.CanonicalEventType, this.stateKey, { disabled: true });
        } catch (ex) {
            await this.intent.underlyingClient.getRoomStateEvent(this.roomId, GitHubDiscussionConnection.LegacyCanonicalEventType, this.stateKey);
            await this.intent.underlyingClient.sendStateEvent(this.roomId, GitHubDiscussionConnection.LegacyCanonicalEventType, this.stateKey, { disabled: true });
        }
    }

    public async ensureGrant(sender?: string) {
        await this.grantChecker.assertConnectionGranted(this.roomId, GitHubDiscussionConnection.grantKey(this.state), sender);
    }
}
