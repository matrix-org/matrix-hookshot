// We need to instantiate some functions which are not directly called, which confuses typescript.
/* eslint-disable @typescript-eslint/ban-ts-comment */
import { IConnection } from "./IConnection";
import { UserTokenStore } from "../UserTokenStore";
import { Appservice } from "matrix-bot-sdk";
import { BotCommands, handleCommand, botCommand, compileBotCommands } from "../BotCommands";
import { MatrixEvent, MatrixMessageContent } from "../MatrixEvent";
import markdown from "markdown-it";
import LogWrapper from "../LogWrapper";
import { GitLabInstance } from "../Config/Config";
import { IGitLabWebhookMREvent } from "../Gitlab/WebhookTypes";

export interface GitLabRepoConnectionState {
    instance: string;
    path: string;
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
    
    static botCommands: BotCommands;

    constructor(public readonly roomId: string,
        private readonly as: Appservice,
        private readonly state: GitLabRepoConnectionState,
        private readonly tokenStore: UserTokenStore,
        private readonly instance: GitLabInstance) {
            if (!state.path || !state.instance) {
                throw Error('Invalid state, missing `path` or `instance`');
            }
    }

    public get path() {
        return this.state.path?.toString();
    }


    public isInterestedInStateEvent() {
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
            id: encodeURIComponent(this.path),
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
    private async onClose(userId: string, number: string) {
        const client = await this.tokenStore.getGitLabForUser(userId, this.instance.url);
        if (!client) {
            await this.as.botIntent.sendText(this.roomId, "You must login to create an issue", "m.notice");
            throw Error('Not logged in');
        }

        await client.issues.edit({
            id: encodeURIComponent(this.state.path),
            issue_iid: number,
            state_event: "close",
        });
    }

    public async onMergeRequestOpened(event: IGitLabWebhookMREvent) {
        log.info(`onMergeRequestOpened ${this.roomId} ${this.path} #${event.object_attributes.iid}`);
        if (!event.object_attributes) {
            throw Error('No merge_request content!');
        }
        if (!event.project) {
            throw Error('No repository content!');
        }
        const orgRepoName = event.project.path_with_namespace;
        const content = `**${event.user.username}** opened a new MR [${orgRepoName}#${event.object_attributes.iid}](${event.object_attributes.url}): "${event.object_attributes.title}"`;
        await this.as.botIntent.sendEvent(this.roomId, {
            msgtype: "m.notice",
            body: content,
            formatted_body: md.renderInline(content),
            format: "org.matrix.custom.html",
        });
    }

    public toString() {
        return `GitHubRepo`;
    }
}

// Typescript doesn't understand Prototypes very well yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const res = compileBotCommands(GitLabRepoConnection.prototype as any);
GitLabRepoConnection.botCommands = res.botCommands;