import { Connection, IConnection, InstantiateConnectionOpts } from "./IConnection";
import { Appservice, Intent, StateEvent } from "matrix-bot-sdk";
import { MatrixMessageContent, MatrixEvent } from "../MatrixEvent";
import markdown from "markdown-it";
import { UserTokenStore } from "../tokens/UserTokenStore";
import { Logger } from "matrix-appservice-bridge";
import { CommentProcessor } from "../CommentProcessor";
import { MessageSenderClient } from "../MatrixSender";
import { ensureUserIsInRoom, getIntentForUser } from "../IntentUtils";
import { FormatUtil } from "../FormatUtil";
import axios from "axios";
import { GithubInstance } from "../github/GithubInstance";
import { IssuesGetCommentResponseData, IssuesGetResponseData, ReposGetResponseData} from "../github/Types";
import { IssuesEditedEvent, IssueCommentCreatedEvent } from "@octokit/webhooks-types";
import { BaseConnection } from "./BaseConnection";
import { BridgeConfigGitHub } from "../config/Config";

export interface GitHubIssueConnectionState {
    org: string;
    repo: string;
    state: string;
    issues: string[];
    // eslint-disable-next-line camelcase
    comments_processed: number;
}

const log = new Logger("GitHubIssueConnection");
const md = new markdown();

interface IQueryRoomOpts {
    as: Appservice;
    tokenStore: UserTokenStore;
    commentProcessor: CommentProcessor;
    messageClient: MessageSenderClient;
    githubInstance: GithubInstance;
}

/**
 * Handles rooms connected to a GitHub issue.
 */
@Connection
export class GitHubIssueConnection extends BaseConnection implements IConnection {
    static readonly CanonicalEventType = "uk.half-shot.matrix-hookshot.github.issue";
    static readonly LegacyCanonicalEventType = "uk.half-shot.matrix-github.bridge";

    static readonly EventTypes = [
        GitHubIssueConnection.CanonicalEventType,
        GitHubIssueConnection.LegacyCanonicalEventType,
    ];

    static readonly QueryRoomRegex = /#github_(.+)_(.+)_(\d+):.*/;
    static readonly ServiceCategory = "github";

    static generateAliasLocalpart(org: string, repo: string, issueNo: string|number) {
        return `github_${org}_${repo}_${issueNo}`;
    }

    public static async createConnectionForState(roomId: string, event: StateEvent<any>, {
        github, config, as, intent, tokenStore, commentProcessor, messageClient}: InstantiateConnectionOpts) {
        if (!github || !config.github) {
            throw Error('GitHub is not configured');
        }
        const issue = new GitHubIssueConnection(
            roomId, as, intent, event.content, event.stateKey || "", tokenStore,
            commentProcessor, messageClient, github, config.github,
        );
        await issue.syncIssueState();
        return issue;
    }

    static async onQueryRoom(result: RegExpExecArray, opts: IQueryRoomOpts): Promise<unknown> {
        const parts = result?.slice(1);
        if (!parts) {
            log.error("Invalid alias pattern");
            throw Error("Could not find issue");
        }

        const owner = parts[0];
        const repoName = parts[1];
        const issueNumber = parseInt(parts[2], 10);

        log.info(`Fetching ${owner}/${repoName}/${issueNumber}`);
        let issue: IssuesGetResponseData;
        let repo: ReposGetResponseData;
        const octokit = opts.githubInstance.getOctokitForRepo(owner, repoName);
        try {
            issue = (await octokit.issues.get({
                owner,
                repo: repoName,
                issue_number: issueNumber,
            })).data;
            repo = (await octokit.repos.get({
                owner,
                repo: repoName,
            })).data;
            if (repo.private) {
                throw Error('Refusing to bridge private repo');
            }
        } catch (ex) {
            log.error("Failed to get issue:", ex);
            throw Error("Could not find issue");
        }

        // URL hack so we don't need to fetch the repo itself.
        const orgRepoName = issue.repository?.full_name;
        let avatarUrl = undefined;
        try {
            const profile = await octokit.users.getByUsername({
                username: owner,
            });
            if (profile.data.avatar_url) {
                const res = await axios.get(profile.data.avatar_url as string, {
                    responseType: 'arraybuffer',
                });
                log.info(`uploading ${profile.data.avatar_url}`);
                const contentType: string = res.headers["content-type"];
                const mxcUrl = await opts.as.botClient.uploadContent(
                    Buffer.from(res.data as ArrayBuffer),
                    contentType,
                    `avatar_${profile.data.id}.png`,
                );
                avatarUrl = {
                    type: "m.room.avatar",
                    state_key: "",
                    content: {
                        url: mxcUrl,
                    },
                };
            }
        } catch (ex) {
            log.info("Failed to get avatar for org:", ex);
            throw ex;
        }

        return {
            visibility: "public",
            name: FormatUtil.formatIssueRoomName(issue, repo),
            topic: FormatUtil.formatRoomTopic(issue),
            preset: "public_chat",
            initial_state: [
                {
                    type: this.CanonicalEventType,
                    content: {
                        org: orgRepoName?.split("/")[0],
                        repo: orgRepoName?.split("/")[1],
                        issues: [String(issue.number)],
                        comments_processed: -1,
                        state: "open",
                    } as GitHubIssueConnectionState,
                    state_key: issue.url,
                },
                avatarUrl,
            ],
        };
    }

    constructor(
        roomId: string,
        private readonly as: Appservice,
        private readonly intent: Intent,
        private state: GitHubIssueConnectionState,
        stateKey: string,
        private tokenStore: UserTokenStore,
        private commentProcessor: CommentProcessor,
        private messageClient: MessageSenderClient,
        private github: GithubInstance,
        private config: BridgeConfigGitHub,
    ) {
        super(roomId, stateKey, GitHubIssueConnection.CanonicalEventType);
    }

    public isInterestedInStateEvent(eventType: string, stateKey: string) {
        return GitHubIssueConnection.EventTypes.includes(eventType) && this.stateKey === stateKey;
    }

    public get issueNumber() {
        return parseInt(this.state.issues[0], 10);
    }

    public get org() {
        return this.state.org.toLowerCase();
    }

    public get repo() {
        return this.state.repo.toLowerCase();
    }

    public async onIssueCommentCreated(event: IssueCommentCreatedEvent) {
        return this.onCommentCreated({
            // TODO: Fix types,
            comment: event.comment as any,
            action: event.action,
        })
    }

    private async onCommentCreated(event: {
        comment: IssuesGetCommentResponseData,
        action: string,
        repository?: ReposGetResponseData,
        issue?: IssuesGetResponseData,
    }, updateState = true) {
        const comment = event.comment;
        if (!comment || !comment.user) {
            throw Error('Comment undefined');
        }
        if (event.repository) {
            // Delay to stop comments racing sends
            await new Promise((resolve) => setTimeout(resolve, 500));
            if (this.commentProcessor.hasCommentBeenProcessed(this.state.org, this.state.repo, this.state.issues[0], comment.id)) {
                return;
            }
        }
        const commentIntent = await getIntentForUser({
            login: comment.user.login,
            avatarUrl: comment.user.avatar_url,
        }, this.as, this.config.userIdPrefix);
        const matrixEvent = await this.commentProcessor.getEventBodyForGitHubComment(comment, event.repository, event.issue);
        // Comment body may be blank
        if (matrixEvent) {
            await ensureUserIsInRoom(commentIntent, this.intent.underlyingClient, this.roomId);
            await this.messageClient.sendMatrixMessage(this.roomId, matrixEvent, "m.room.message", commentIntent.userId);
        }
        if (!updateState) {
            return;
        }
        this.state.comments_processed++;
        await this.intent.underlyingClient.sendStateEvent(
            this.roomId,
            GitHubIssueConnection.CanonicalEventType,
            this.stateKey,
            this.state,
        );
    }

    public async syncIssueState() {
        log.debug("Syncing issue state for", this.roomId);
        const issue = await this.github.getOctokitForRepo(this.org, this.repo).issues.get({
            owner: this.state.org,
            repo: this.state.repo,
            issue_number: this.issueNumber,
        });

        if (this.state.comments_processed === -1) {
            // This has a side effect of creating a profile for the user.
            const creator = await getIntentForUser({
                // TODO: Fix
                login: issue.data.user?.login as string,
                avatarUrl: issue.data.user?.avatar_url || undefined
            }, this.as, this.config.userIdPrefix);
            // We've not sent any messages into the room yet, let's do it!
            if (issue.data.body) {
                await ensureUserIsInRoom(creator, this.intent.underlyingClient, this.roomId);
                await this.messageClient.sendMatrixMessage(this.roomId, {
                    msgtype: "m.text",
                    external_url: issue.data.html_url,
                    body: `${issue.data.body} (${issue.data.updated_at})`,
                    format: "org.matrix.custom.html",
                    formatted_body: md.render(issue.data.body),
                }, "m.room.message", creator.userId);
            }
            if (issue.data.pull_request) {
                // Send a patch in
                // ...was this intended as a request for code?
            }
            this.state.comments_processed = 0;
        }

        if (this.state.comments_processed !== issue.data.comments) {
            const comments = (await this.github.getOctokitForRepo(this.org, this.repo).issues.listComments({
                owner: this.state.org,
                repo: this.state.repo,
                issue_number: this.issueNumber,
                // TODO: Use since to get a subset
            })).data.slice(this.state.comments_processed);

            for (const comment of comments) {
                await this.onCommentCreated({
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    comment: comment as any,
                    action: "fake",
                }, false);
                this.state.comments_processed++;
            }
        }

        if (this.state.state !== issue.data.state) {
            if (issue.data.state === "closed") {
                // TODO: Fix
                const closedUserId = this.as.getUserIdForSuffix(issue.data.closed_by?.login as string);
                await ensureUserIsInRoom(
                    this.as.getIntentForUserId(closedUserId),
                    this.intent.underlyingClient,
                    this.roomId
                );
                await this.messageClient.sendMatrixMessage(this.roomId, {
                    msgtype: "m.notice",
                    body: `closed the ${issue.data.pull_request ? "pull request" : "issue"} at ${issue.data.closed_at}`,
                    external_url: issue.data.closed_by?.html_url,
                }, "m.room.message", closedUserId);
            }

            await this.intent.underlyingClient.sendStateEvent(this.roomId, "m.room.topic", "", {
                topic: FormatUtil.formatRoomTopic(issue.data),
            });

            this.state.state = issue.data.state;
        }

        await this.intent.underlyingClient.sendStateEvent(
            this.roomId,
            GitHubIssueConnection.CanonicalEventType,
            this.stateKey,
            this.state,
        );
    }


    public async onMatrixIssueComment(event: MatrixEvent<MatrixMessageContent>, allowEcho = false) {
        const clientKit = await this.tokenStore.getOctokitForUser(event.sender);
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

        const result = await clientKit.issues.createComment({
            repo: this.state.repo,
            owner: this.state.org,
            body: await this.commentProcessor.getCommentBodyForEvent(event, false),
            issue_number: parseInt(this.state.issues[0], 10),
        });

        if (!allowEcho) {
            this.commentProcessor.markCommentAsProcessed(this.state.org, this.state.repo, this.state.issues[0], result.data.id);
        }
    }

    public async onIssueEdited(event: IssuesEditedEvent) {
        if (!event.changes) {
            log.debug("No changes given");
            return; // No changes made.
        }

        // TODO: Fix types
        if (event.issue && event.changes.title) {
            await this.intent.underlyingClient.sendStateEvent(this.roomId, "m.room.name", "", {
                name: FormatUtil.formatIssueRoomName(event.issue, event.repository),
            });
        }
    }

    public async onRemove() {
        log.info(`Removing ${this.toString()} for ${this.roomId}`);
        // Do a sanity check that the event exists.
        try {
            await this.intent.underlyingClient.getRoomStateEvent(this.roomId, GitHubIssueConnection.CanonicalEventType, this.stateKey);
            await this.intent.underlyingClient.sendStateEvent(this.roomId, GitHubIssueConnection.CanonicalEventType, this.stateKey, { disabled: true });
        } catch (ex) {
            await this.intent.underlyingClient.getRoomStateEvent(this.roomId, GitHubIssueConnection.LegacyCanonicalEventType, this.stateKey);
            await this.intent.underlyingClient.sendStateEvent(this.roomId, GitHubIssueConnection.LegacyCanonicalEventType, this.stateKey, { disabled: true });
        }
    }

    public onIssueStateChange() {
        return this.syncIssueState();
    }

    public async onMessageEvent(ev: MatrixEvent<MatrixMessageContent>) {
        if (ev.content.body === '!sync') {
            // Sync data.
            await this.syncIssueState();
            return true;
        }
        await this.onMatrixIssueComment(ev);
        return true;
    }

    public toString() {
        return `GitHubIssue ${this.state.org}/${this.state.repo}#${this.state.issues.join(",")}`;
    }
}
