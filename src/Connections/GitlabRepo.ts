import { IConnection } from "./IConnection";
import { UserTokenStore } from "../UserTokenStore";
import { Appservice } from "matrix-bot-sdk";
import { BotCommands, handleCommand, botCommand, compileBotCommands } from "../BotCommands";
import { MatrixEvent, MatrixMessageContent } from "../MatrixEvent";
import markdown from "markdown-it";
import LogWrapper from "../LogWrapper";
import { GitLabInstance } from "../Config";

export interface GitLabRepoConnectionState {
    instance: string;
    org: string;
    repo: string;
    state: string;
}

const log = new LogWrapper("GitLabRepoConnection");
const md = new markdown();

/**
 * Handles rooms connected to a github repo.
 */
export class GitLabRepoConnection implements IConnection {
    static readonly CanonicalEventType = "uk.half-shot.matrix-github.gitlab.repository";

    static readonly EventTypes = [
        GitLabRepoConnection.CanonicalEventType, // Legacy event, with an awful name.
    ];
    
    static helpMessage: any;
    static botCommands: BotCommands;

    constructor(public readonly roomId: string,
        private readonly as: Appservice,
        private readonly state: GitLabRepoConnectionState,
        private readonly tokenStore: UserTokenStore,
        private readonly instance: GitLabInstance) {

    }

    public get org() {
        return this.state.org;
    }

    public get repo() {
        return this.state.repo;
    }

    public isInterestedInStateEvent(eventType: string) {
        return false;
    }

    public async onMessageEvent(ev: MatrixEvent<MatrixMessageContent>) {
        const { error, handled } = await handleCommand(ev.sender, ev.content.body, GitLabRepoConnection.botCommands, this);
        if (!handled) {
            // Not for us.
            return;
        }
        if (error) {
            log.error(error);
            await this.as.botIntent.sendEvent(this.roomId,{
                msgtype: "m.notice",
                body: "Failed to handle command",
            });
            return;
        }
        await this.as.botClient.sendEvent(this.roomId, "m.reaction", {
            "m.relates_to": {
                rel_type: "m.annotation",
                event_id: ev.event_id,
                key: "✅",
            }
        });
    }

    @botCommand("gl create", "Create an issue for this repo", ["title"], ["description", "labels"], true)
    // @ts-ignore
    private async onCreateIssue(userId: string, title: string, description?: string, labels?: string) {
        const client = await this.tokenStore.getGitLabForUser(userId, this.instance.url);
        if (!client) {
            await this.as.botIntent.sendText(this.roomId, "You must login to create an issue", "m.notice");
            throw Error('Not logged in');
        }
        const res = await client.issues.create({
            id: encodeURIComponent(`${this.state.org}/${this.state.repo}`),
            title,
            description,
            labels: labels ? labels.split(",") : undefined,
        });

        const content = `Created issue #${res.iid}: [${res.web_url}](${res.web_url})`;
        return this.as.botIntent.sendEvent(this.roomId,{
            msgtype: "m.notice",
            body: content,
            formatted_body: md.render(content),
            format: "org.matrix.custom.html"
        });
    }

    @botCommand("gl close", "Close an issue", ["number"], ["comment"], true)
    // @ts-ignore
    private async onClose(userId: string, number: string, comment?: string) {
        const client = await this.tokenStore.getGitLabForUser(userId, this.instance.url);
        if (!client) {
            await this.as.botIntent.sendText(this.roomId, "You must login to create an issue", "m.notice");
            throw Error('Not logged in');
        }

        await client.issues.edit({
            id: encodeURIComponent(`${this.state.org}/${this.state.repo}`),
            issue_iid: number,
            state_event: "close",
        });
    }

    // public async onIssueCreated(event: IGitHubWebhookEvent) {

    // }

    // public async onIssueStateChange(event: IGitHubWebhookEvent) {

    // }

    public async onEvent(evt: MatrixEvent<unknown>) {

    }

    public async onStateUpdate() { }

    public toString() {
        return `GitHubRepo`;
    }
}

const res = compileBotCommands(GitLabRepoConnection.prototype);
GitLabRepoConnection.helpMessage = res.helpMessage;
GitLabRepoConnection.botCommands = res.botCommands;