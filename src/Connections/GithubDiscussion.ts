import { IConnection } from "./IConnection";
import { Appservice, MatrixEvent } from "matrix-bot-sdk";
import { UserTokenStore } from "../UserTokenStore";
import { CommentProcessor } from "../CommentProcessor";
import { MessageSenderClient } from "../MatrixSender";
import { getIntentForUser } from "../IntentUtils";
import { Discussion } from "../Github/Discussion";
import { MatrixMessageContent } from "../MatrixEvent";

export interface GitHubDiscussionConnectionState {
    owner: string;
    name: string;
    discussion: number;
}

// const log = new LogWrapper("GitHubDiscussion");
// const md = new markdown();

/**
 * Handles rooms connected to a github repo.
 */
export class GitHubDiscussionConnection implements IConnection {
    static readonly CanonicalEventType = "uk.half-shot.matrix-github.discussion";

    static readonly EventTypes = [
        GitHubDiscussionConnection.CanonicalEventType, // Legacy event, with an awful name.
    ];

    static readonly QueryRoomRegex = /#github_disc_(.+)_(.+)_(\d+):.*/;

    public static async createDiscussionRoom(
        as: Appservice, userId: string, owner: string, name: string, discussion: Discussion,
        tokenStore: UserTokenStore, commentProcessor: CommentProcessor, messageClient: MessageSenderClient
    ) {
        const commentIntent = await getIntentForUser({
            login: discussion.author.login,
            avatarUrl: discussion.author.avatarUrl,
        }, as);
        const state: GitHubDiscussionConnectionState = {
            owner,
            name,
            discussion: discussion.number,
        };
        const roomId = await commentIntent.underlyingClient.createRoom({
            invite: [userId, as.botUserId],
            preset: 'private_chat',
            name: `${discussion.title} (${owner}/${name})`,
            room_alias_name: `github_disc_${owner.toLowerCase()}_${name.toLowerCase()}_${discussion.number}`,
            initial_state: [{
                content: state,
                state_key: '',
                type: GitHubDiscussionConnection.CanonicalEventType,
            }],
        });
        await commentIntent.sendEvent(roomId, {
            msgtype: 'm.text',
            body: discussion.bodyText,
            formatted_body: discussion.bodyHTML,
            format: 'org.matrix.custom.html',
        });
        await as.botIntent.joinRoom(roomId);
        return new GitHubDiscussionConnection(roomId, as, state, '', tokenStore, commentProcessor, messageClient);
    }

    constructor(public readonly roomId: string,
        private readonly as: Appservice,
        private state: GitHubDiscussionConnectionState,
        private readonly stateKey: string,
        private tokenStore: UserTokenStore,
        private commentProcessor: CommentProcessor,
        private messageClient: MessageSenderClient) {
        }

    public isInterestedInStateEvent(eventType: string, stateKey: string) {
        return GitHubDiscussionConnection.EventTypes.includes(eventType) && this.stateKey === stateKey;
    }

    public async onMessageEvent(ev: MatrixEvent<MatrixMessageContent>) {
        const octokit = this.tokenStore.getOctokitForUser(ev.sender);
        if (!octokit) {
            // Use Reply - Also mention user.
            await this.as.botClient.sendNotice(this.roomId, `${ev.sender}: Cannot send comment, you are not logged into GitHub`);
            return;
        }
    }

    public get discussionNumber() {
        return this.state.discussion;
    }

    public get name() {
        return this.state.name;
    }

    public get owner() {
        return this.state.owner;
    }

    public toString() {
        return `GitHubDiscussion ${this.owner}/${this.name}#${this.state.discussion}`;
    }
}