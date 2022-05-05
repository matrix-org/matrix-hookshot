// We need to instantiate some functions which are not directly called, which confuses typescript.
/* eslint-disable @typescript-eslint/ban-ts-comment */
import { UserTokenStore } from "../UserTokenStore";
import { Appservice } from "matrix-bot-sdk";
import { BotCommands, botCommand, compileBotCommands } from "../BotCommands";
import { MatrixEvent, MatrixMessageContent } from "../MatrixEvent";
import markdown from "markdown-it";
import LogWrapper from "../LogWrapper";
import { GitLabInstance } from "../Config/Config";
import { IGitLabWebhookMREvent, IGitLabWebhookPushEvent, IGitLabWebhookReleaseEvent, IGitLabWebhookTagPushEvent, IGitLabWebhookWikiPageEvent } from "../Gitlab/WebhookTypes";
import { CommandConnection } from "./CommandConnection";
import { IConnectionState } from "./IConnection";

export interface GitLabRepoConnectionState extends IConnectionState {
    instance: string;
    path: string;
    ignoreHooks?: string[],
    commandPrefix?: string;
    pushTagsRegex?: string,
    includingLabels?: string[];
    excludingLabels?: string[];
}

const log = new LogWrapper("GitLabRepoConnection");
const md = new markdown();

const PUSH_MAX_COMMITS = 5;

/**
 * Handles rooms connected to a github repo.
 */
export class GitLabRepoConnection extends CommandConnection {
    static readonly CanonicalEventType = "uk.half-shot.matrix-hookshot.gitlab.repository";
    static readonly LegacyCanonicalEventType = "uk.half-shot.matrix-github.gitlab.repository";

    static readonly EventTypes = [
        GitLabRepoConnection.CanonicalEventType,
        GitLabRepoConnection.LegacyCanonicalEventType,
    ];
    
    static botCommands: BotCommands;
    static helpMessage: (cmdPrefix?: string | undefined) => MatrixMessageContent;

    constructor(roomId: string,
        stateKey: string,
        private readonly as: Appservice,
        private state: GitLabRepoConnectionState,
        private readonly tokenStore: UserTokenStore,
        private readonly instance: GitLabInstance) {
            super(
                roomId,
                stateKey,
                GitLabRepoConnection.CanonicalEventType,
                as.botClient,
                GitLabRepoConnection.botCommands,
                GitLabRepoConnection.helpMessage,
                state.commandPrefix || "!gl",
                "gitlab",
            )
            if (!state.path || !state.instance) {
                throw Error('Invalid state, missing `path` or `instance`');
            }
    }

    public get path() {
        return this.state.path?.toString();
    }

    public get priority(): number {
        return this.state.priority || super.priority;
    }

    public async onStateUpdate(stateEv: MatrixEvent<unknown>) {
        const state = stateEv.content as GitLabRepoConnectionState;
        this.state = state;
    }

    public isInterestedInStateEvent(eventType: string, stateKey: string) {
        return GitLabRepoConnection.EventTypes.includes(eventType) && this.stateKey === stateKey;
    }

    @botCommand("create", "Create an issue for this repo", ["title"], ["description", "labels"], true)
    public async onCreateIssue(userId: string, title: string, description?: string, labels?: string) {
        const client = await this.tokenStore.getGitLabForUser(userId, this.instance.url);
        if (!client) {
            await this.as.botIntent.sendText(this.roomId, "You must be logged in to create an issue.", "m.notice");
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

    @botCommand("close", "Close an issue", ["number"], ["comment"], true)
    public async onClose(userId: string, number: string) {
        const client = await this.tokenStore.getGitLabForUser(userId, this.instance.url);
        if (!client) {
            await this.as.botIntent.sendText(this.roomId, "You must be logged in to create an issue.", "m.notice");
            throw Error('Not logged in');
        }

        await client.issues.edit({
            id: encodeURIComponent(this.state.path),
            issue_iid: number,
            state_event: "close",
        });
    }

    private validateMREvent(event: IGitLabWebhookMREvent) {
        if (!event.object_attributes) {
            throw Error('No merge_request content!');
        }
        if (!event.project) {
            throw Error('No repository content!');
        }
    }

    public async onMergeRequestOpened(event: IGitLabWebhookMREvent) {
        log.info(`onMergeRequestOpened ${this.roomId} ${this.path} #${event.object_attributes.iid}`);
        if (this.shouldSkipHook('merge_request.open') || !this.matchesLabelFilter(event)) {
            return;
        }
        this.validateMREvent(event);
        const orgRepoName = event.project.path_with_namespace;
        const content = `**${event.user.username}** opened a new MR [${orgRepoName}#${event.object_attributes.iid}](${event.object_attributes.url}): "${event.object_attributes.title}"`;
        await this.as.botIntent.sendEvent(this.roomId, {
            msgtype: "m.notice",
            body: content,
            formatted_body: md.renderInline(content),
            format: "org.matrix.custom.html",
        });
    }

    public async onMergeRequestClosed(event: IGitLabWebhookMREvent) {
        log.info(`onMergeRequestClosed ${this.roomId} ${this.path} #${event.object_attributes.iid}`);
        if (this.shouldSkipHook('merge_request.close') || !this.matchesLabelFilter(event)) {
            return;
        }
        this.validateMREvent(event);
        const orgRepoName = event.project.path_with_namespace;
        const content = `**${event.user.username}** closed MR [${orgRepoName}#${event.object_attributes.iid}](${event.object_attributes.url}): "${event.object_attributes.title}"`;
        await this.as.botIntent.sendEvent(this.roomId, {
            msgtype: "m.notice",
            body: content,
            formatted_body: md.renderInline(content),
            format: "org.matrix.custom.html",
        });
    }

    public async onMergeRequestMerged(event: IGitLabWebhookMREvent) {
        log.info(`onMergeRequestMerged ${this.roomId} ${this.path} #${event.object_attributes.iid}`);
        if (this.shouldSkipHook('merge_request.merge') || !this.matchesLabelFilter(event)) {
            return;
        }
        this.validateMREvent(event);
        const orgRepoName = event.project.path_with_namespace;
        const content = `**${event.user.username}** merged MR [${orgRepoName}#${event.object_attributes.iid}](${event.object_attributes.url}): "${event.object_attributes.title}"`;
        await this.as.botIntent.sendEvent(this.roomId, {
            msgtype: "m.notice",
            body: content,
            formatted_body: md.renderInline(content),
            format: "org.matrix.custom.html",
        });
    }

    public async onMergeRequestReviewed(event: IGitLabWebhookMREvent) {
        if (this.shouldSkipHook('merge_request.review', `merge_request.${event.object_attributes.action}`) || !this.matchesLabelFilter(event)) {
            return;
        }
        log.info(`onMergeRequestReviewed ${this.roomId} ${this.instance}/${this.path} ${event.object_attributes.iid}`);
        this.validateMREvent(event);
        if (event.object_attributes.action !== "approved" && event.object_attributes.action !== "unapproved") {
            // Not interested.
            return;
        }
        const emojiForReview = {
            'approved': '✅',
            'unapproved': '🔴'
        }[event.object_attributes.action];
        const orgRepoName = event.project.path_with_namespace;
        const content = `**${event.user.username}** ${emojiForReview} ${event.object_attributes.action} MR [${orgRepoName}#${event.object_attributes.iid}](${event.object_attributes.url}): "${event.object_attributes.title}"`;
        await this.as.botIntent.sendEvent(this.roomId, {
            msgtype: "m.notice",
            body: content,
            formatted_body: md.renderInline(content),
            format: "org.matrix.custom.html",
        });
    }

    public async onGitLabTagPush(event: IGitLabWebhookTagPushEvent) {
        log.info(`onGitLabTagPush ${this.roomId} ${this.instance.url}/${this.path} ${event.ref}`);
        if (this.shouldSkipHook('tag_push')) {
            return;
        }
        const tagname = event.ref.replace("refs/tags/", "");
        if (this.state.pushTagsRegex && !tagname.match(this.state.pushTagsRegex)) {
            return;
        }
        const url = `${event.project.homepage}/-/tree/${tagname}`;
        const content = `**${event.user_name}** pushed tag [\`${tagname}\`](${url}) for ${event.project.path_with_namespace}`;
        await this.as.botIntent.sendEvent(this.roomId, {
            msgtype: "m.notice",
            body: content,
            formatted_body: md.renderInline(content),
            format: "org.matrix.custom.html",
        });
    }


    public async onGitLabPush(event: IGitLabWebhookPushEvent) {
        log.info(`onGitLabPush ${this.roomId} ${this.instance.url}/${this.path} ${event.after}`);
        if (this.shouldSkipHook('push')) {
            return;
        }
        const branchname = event.ref.replace("refs/heads/", "");
        const commitsurl = `${event.project.homepage}/-/commits/${branchname}`;
        const branchurl = `${event.project.homepage}/-/tree/${branchname}`;
        const shouldName = !event.commits.every(c => c.author.name === event.commits[0]?.author.name);

        const tooManyCommits = event.total_commits_count > PUSH_MAX_COMMITS;
        const displayedCommits = tooManyCommits ? 1 : PUSH_MAX_COMMITS;
        
        // Take the top 5 commits. The array is ordered in reverse.
        const commits = event.commits.reverse().slice(0,displayedCommits).map(commit => {
            return `[\`${commit.id.slice(0,8)}\`](${event.project.homepage}/-/commit/${commit.id}) ${commit.title}${shouldName ? ` by ${commit.author.name}` : ""}`;
        }).join('\n - ');

        let content = `**${event.user_name}** pushed [${event.total_commits_count} commit${event.total_commits_count > 1 ? "s": ""}](${commitsurl})`
        + ` to [\`${branchname}\`](${branchurl}) for ${event.project.path_with_namespace}`;

        if (event.commits.length >= 2) {
            content += `\n - ${commits}\n`;
        } else if (event.commits.length === 1) {
            content += ` - ${commits}`;
        }
        if (tooManyCommits) {
            content += `. View [${event.total_commits_count - 1} more](${commitsurl}).`;
        }

        await this.as.botIntent.sendEvent(this.roomId, {
            msgtype: "m.notice",
            body: content,
            formatted_body: md.render(content),
            format: "org.matrix.custom.html",
        });
    }
    
    public async onWikiPageEvent(data: IGitLabWebhookWikiPageEvent) {
        const attributes = data.object_attributes;
        log.info(`onWikiPageEvent ${this.roomId} ${this.instance}/${this.path}`);
        if (this.shouldSkipHook('wiki', `wiki.${attributes.action}`)) {
            return;
        }

        let statement: string;
        if (attributes.action === "create") {
            statement = "created new wiki page";
        } else if (attributes.action === "delete") {
            statement = "deleted wiki page";
        } else {
            statement = "updated wiki page";
        }

        const message = attributes.message && ` "${attributes.message}"`;

        const content = `**${data.user.username}** ${statement} "[${attributes.title}](${attributes.url})" for ${data.project.path_with_namespace} ${message}`;
        await this.as.botIntent.sendEvent(this.roomId, {
            msgtype: "m.notice",
            body: content,
            formatted_body: md.renderInline(content),
            format: "org.matrix.custom.html",
        });
    }

    public async onRelease(data: IGitLabWebhookReleaseEvent) {
        if (this.shouldSkipHook('release', 'release.created')) {
            return;
        }
        log.info(`onReleaseCreated ${this.roomId} ${this.toString()} ${data.tag}`);
        const orgRepoName = data.project.path_with_namespace;
        const content = `**${data.commit.author.name}** 🪄 released [${data.name}](${data.url}) for ${orgRepoName}

${data.description}`;
        await this.as.botIntent.sendEvent(this.roomId, {
            msgtype: "m.notice",
            body: content,
            formatted_body: md.render(content),
            format: "org.matrix.custom.html",
        });
    }

    public toString() {
        return `GitLabRepo ${this.instance.url}/${this.path}`;
    }

    public matchesLabelFilter(itemWithLabels: {labels?: {title: string}[]}): boolean {
        const labels = itemWithLabels.labels?.map(l => l.title) || [];
        if (this.state.excludingLabels?.length) {
            if (this.state.excludingLabels.find(l => labels.includes(l))) {
                return false;
            }
        }
        if (this.state.includingLabels?.length) {
            return !!this.state.includingLabels.find(l => labels.includes(l));
        }
        return true;
    }

    private shouldSkipHook(...hookName: string[]) {
        if (this.state.ignoreHooks) {
            for (const name of hookName) {
                if (this.state.ignoreHooks?.includes(name)) {
                    return true;
                }
            }
        }
        return false;
    }
}

// Typescript doesn't understand Prototypes very well yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const res = compileBotCommands(GitLabRepoConnection.prototype as any, CommandConnection.prototype as any);
GitLabRepoConnection.helpMessage = res.helpMessage;
GitLabRepoConnection.botCommands = res.botCommands;
