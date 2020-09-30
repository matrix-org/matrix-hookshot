import { IConnection } from "./IConnection";
import { Appservice } from "matrix-bot-sdk";
import { MatrixMessageContent, MatrixEvent } from "../MatrixEvent";
import markdown from "markdown-it";
import { UserTokenStore } from "../UserTokenStore";
import LogWrapper from "../LogWrapper";
import { CommentProcessor } from "../CommentProcessor";
import { MessageSenderClient } from "../MatrixSender";
import { FormatUtil } from "../FormatUtil";
import { IGitHubWebhookEvent } from "../GithubWebhooks";
import { GitLabInstance } from "../Config";

export interface GitLabIssueConnectionState {
    instance: string;
    projects: string[];
    state: string;
    issue: number;
    comments_processed: number;
}

const log = new LogWrapper("GitLabIssueConnection");
const md = new markdown();

md.render("foo");

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
export class GitLabIssueConnection implements IConnection {
    static readonly CanonicalEventType = "uk.half-shot.matrix-github.gitlab.issue";

    static readonly EventTypes = [
        GitLabIssueConnection.CanonicalEventType,
    ];

    static readonly QueryRoomRegex = /#gitlab_(.+)_(.+)_(\d+):.*/;

    public static createRoomForIssue() {

    }

    public get projectPath() {
        return this.state.projects.join("/");
    }

    public get instanceUrl() {
        return this.instance.url;
    }

    constructor(public readonly roomId: string,
        private readonly as: Appservice,
        private state: GitLabIssueConnectionState,
        private readonly stateKey: string,
        private tokenStore: UserTokenStore,
        private commentProcessor: CommentProcessor,
        private messageClient: MessageSenderClient,
        private instance: GitLabInstance) {
        }

    public isInterestedInStateEvent(eventType: string, stateKey: string) {
        return GitLabIssueConnection.EventTypes.includes(eventType) && this.stateKey === stateKey;
    }

    public get issueNumber() {
        return this.state.issue;
    }

    // public async onCommentCreated(event: IGitHubWebhookEvent, updateState = true) {
    //     const comment = event.comment!;
    //     if (event.repository) {
    //         // Delay to stop comments racing sends
    //         await new Promise((resolve) => setTimeout(resolve, 500));
    //         if (this.commentProcessor.hasCommentBeenProcessed(this.state.org, this.state.repo, this.state.issues[0], comment.id)) {
    //             return;
    //         }
    //     }
    //     const commentIntent = await getIntentForUser(comment.user, this.as, this.octokit);
    //     const matrixEvent = await this.commentProcessor.getEventBodyForComment(comment, event.repository, event.issue);

    //     await this.messageClient.sendMatrixMessage(this.roomId, matrixEvent, "m.room.message", commentIntent.userId);
    //     if (!updateState) {
    //         return;
    //     }
    //     this.state.comments_processed++;
    //     await this.as.botIntent.underlyingClient.sendStateEvent(
    //         this.roomId,
    //         GitLabIssueConnection.CanonicalEventType,
    //         this.stateKey,
    //         this.state,
    //     );
    // }

    // private async syncIssueState() {
    //     log.debug("Syncing issue state for", this.roomId);
    //     const issue = await this.octokit.issues.get({
    //         owner: this.state.org,
    //         repo: this.state.repo,
    //         issue_number: this.issueNumber,
    //     });

    //     if (this.state.comments_processed === -1) {
    //         // This has a side effect of creating a profile for the user.
    //         const creator = await getIntentForUser(issue.data.user, this.as, this.octokit);
    //         // We've not sent any messages into the room yet, let's do it!
    //         if (issue.data.body) {
    //             await this.messageClient.sendMatrixMessage(this.roomId, {
    //                 msgtype: "m.text",
    //                 external_url: issue.data.html_url,
    //                 body: `${issue.data.body} (${issue.data.updated_at})`,
    //                 format: "org.matrix.custom.html",
    //                 formatted_body: md.render(issue.data.body),
    //             }, "m.room.message", creator.userId);
    //         }
    //         if (issue.data.pull_request) {
    //             // Send a patch in
    //             // ...was this intended as a request for code?
    //         }
    //         this.state.comments_processed = 0;
    //     }

    //     if (this.state.comments_processed !== issue.data.comments) {
    //         const comments = (await this.octokit.issues.listComments({
    //             owner: this.state.org,
    //             repo: this.state.repo,
    //             issue_number: this.issueNumber,
    //             // TODO: Use since to get a subset
    //         })).data.slice(this.state.comments_processed);

    //         for (const comment of comments) {
    //             await this.onCommentCreated({
    //                 comment,
    //                 action: "fake",
    //             }, false);
    //             this.state.comments_processed++;
    //         }
    //     }

    //     if (this.state.state !== issue.data.state) {
    //         if (issue.data.state === "closed") {
    //             const closedUserId = this.as.getUserIdForSuffix(issue.data.closed_by.login);
    //             await this.messageClient.sendMatrixMessage(this.roomId, {
    //                 msgtype: "m.notice",
    //                 body: `closed the ${issue.data.pull_request ? "pull request" : "issue"} at ${issue.data.closed_at}`,
    //                 external_url: issue.data.closed_by.html_url,
    //             }, "m.room.message", closedUserId);
    //         }

    //         await this.as.botIntent.underlyingClient.sendStateEvent(this.roomId, "m.room.topic", "", {
    //             topic: FormatUtil.formatRoomTopic(issue.data),
    //         });

    //         this.state.state = issue.data.state;
    //     }

    //     await this.as.botIntent.underlyingClient.sendStateEvent(
    //         this.roomId,
    //         GitLabIssueConnection.CanonicalEventType,
    //         this.stateKey,
    //         this.state,
    //     );
    // }


    public async onMatrixIssueComment(event: MatrixEvent<MatrixMessageContent>, allowEcho: boolean = false) {

        console.log(this.messageClient, this.commentProcessor);
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

        // const result = await clientKit.issues.createComment({
        //     repo: this.state.repo,
        //     owner: this.state.org,
        //     body: await this.commentProcessor.getCommentBodyForEvent(event, false),
        //     issue_number: parseInt(this.state.issues[0], 10),
        // });

        if (!allowEcho) {
            //this.commentProcessor.markCommentAsProcessed(this.state.org, this.state.repo, this.state.issues[0], result.data.id);
        }
    }

    public async onIssueEdited(event: IGitHubWebhookEvent) {
        if (!event.changes) {
            log.debug("No changes given");
            return; // No changes made.
        }

        if (event.changes.title) {
            await this.as.botIntent.underlyingClient.sendStateEvent(this.roomId, "m.room.name", "", {
                name: FormatUtil.formatIssueRoomName(event.issue!),
            });
        }
    }

    // public onIssueStateChange(event: IGitHubWebhookEvent) {
    //     return this.syncIssueState();
    // }

    public async onEvent() {

    }

    public async onStateUpdate() {

    }

    public async onMessageEvent(ev: MatrixEvent<MatrixMessageContent>) {
        if (ev.content.body === '!sync') {
            // Sync data.
           // return this.syncIssueState();
        }
        await this.onMatrixIssueComment(ev);
    }

    public toString() {
        return `GitLabIssue ${this.instanceUrl}/${this.projectPath}#${this.issueNumber}`;
    }
}