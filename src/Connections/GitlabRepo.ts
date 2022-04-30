// We need to instantiate some functions which are not directly called, which confuses typescript.
/* eslint-disable @typescript-eslint/ban-ts-comment */
import { UserTokenStore } from "../UserTokenStore";
import { Appservice } from "matrix-bot-sdk";
import { BotCommands, botCommand, compileBotCommands } from "../BotCommands";
import { MatrixEvent, MatrixMessageContent } from "../MatrixEvent";
import markdown from "markdown-it";
import LogWrapper from "../LogWrapper";
import { BridgeConfigGitLab, GitLabInstance } from "../Config/Config";
import { IGitLabWebhookMREvent, IGitLabWebhookNoteEvent, IGitLabWebhookPushEvent, IGitLabWebhookReleaseEvent, IGitLabWebhookTagPushEvent, IGitLabWebhookWikiPageEvent } from "../Gitlab/WebhookTypes";
import { CommandConnection } from "./CommandConnection";
import { IConnectionState } from "./IConnection";
import { GetConnectionsResponseItem } from "../provisioning/api";
import { ErrCode, ApiError } from "../api"
import { AccessLevel } from "../Gitlab/Types";

export interface GitLabRepoConnectionState extends IConnectionState {
    instance: string;
    path: string;
    ignoreHooks?: AllowedEventsNames[],
    commandPrefix?: string;
    pushTagsRegex?: string,
    includingLabels?: string[];
    excludingLabels?: string[];
}


export interface GitLabRepoConnectionInstanceTarget {
    name: string;
}
export interface GitLabRepoConnectionProjectTarget {
    state: GitLabRepoConnectionState;
    name: string;
}

export type GitLabRepoConnectionTarget = GitLabRepoConnectionInstanceTarget|GitLabRepoConnectionProjectTarget;

const log = new LogWrapper("GitLabRepoConnection");
const md = new markdown();

const MRRCOMMENT_DEBOUNCE_MS = 5000;


export type GitLabRepoResponseItem = GetConnectionsResponseItem<GitLabRepoConnectionState, undefined>;


type AllowedEventsNames = 
    "merge_request.open" |
    "merge_request.close" |
    "merge_request.merge" |
    "merge_request.review" |
    "merge_request.review.comments" |
    `merge_request.${string}` |
    "merge_request" |
    "tag_push" | 
    "push" |
    "wiki" |
    `wiki.${string}` |
    "release" |
    "release.created";

const AllowedEvents: AllowedEventsNames[] = [
    "merge_request.open",
    "merge_request.close",
    "merge_request.merge",
    "merge_request.review",
    "merge_request.review.comments",
    "merge_request",
    "tag_push",
    "push",
    "wiki",
    "release",
    "release.created",
];

export interface GitLabTargetFilter {
    instance?: string;
    parent?: string;
    after?: string;
    search?: string;
}


function validateState(state: Record<string, unknown>): GitLabRepoConnectionState {
    if (typeof state.instance !== "string") {
        throw new ApiError("Expected a 'instance' property", ErrCode.BadValue);
    }
    if (typeof state.path !== "string") {
        throw new ApiError("Expected a 'path' property", ErrCode.BadValue);
    }
    const res: GitLabRepoConnectionState = {
        instance: state.instance,
        path: state.path,
    }
    if (state.commandPrefix) {
        if (typeof state.commandPrefix !== "string") {
            throw new ApiError("Expected 'commandPrefix' to be a string", ErrCode.BadValue);
        } else if (state.commandPrefix.length >= 2 || state.commandPrefix.length <= 24) {
            res.commandPrefix = state.commandPrefix;
        } else if (state.commandPrefix.length > 0) {
            throw new ApiError("Expected 'commandPrefix' to be between 2-24 characters", ErrCode.BadValue);
        }
        // Otherwise empty string, ignore.
    }
    if (state.ignoreHooks && Array.isArray(state.ignoreHooks)) {
        if (state.ignoreHooks?.find((ev) => !AllowedEvents.includes(ev))?.length) {
            throw new ApiError(`'events' can only contain ${AllowedEvents.join(", ")}`, ErrCode.BadValue);
        }
        res.ignoreHooks = state.ignoreHooks;
    }
    return res;
}

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

    private readonly debounceMRComments = new Map<string, {comments: number, author: string, timeout: NodeJS.Timeout}>();

    public static async provisionConnection(roomId: string, requester: string, data: Record<string, unknown>, as: Appservice, tokenStore: UserTokenStore, instanceName: string, gitlabConfig: BridgeConfigGitLab) {
        const validData = validateState(data);
        const instance = gitlabConfig.instances[instanceName];
        if (!instance) {
            throw Error(`provisionConnection provided an instanceName of ${instanceName} but the instance does not exist`);
        }
        const client = await tokenStore.getGitLabForUser(requester, instance.url);
        if (!client) {
            throw new ApiError("User is not authenticated with GitLab", ErrCode.ForbiddenUser);
        }
        let permissionLevel;
        let project;
        try {
            project = await client.projects.get(validData.path);
            permissionLevel = Math.max(project.permissions.group_access?.access_level || 0, project.permissions.project_access?.access_level || 0) as AccessLevel;
        } catch (ex) {
            throw new ApiError("Could not determine if the user has access to this project, does the project exist?", ErrCode.ForbiddenUser);
        }

        if (permissionLevel < AccessLevel.Developer) {
            throw new ApiError("You must at least have developer access to bridge this project", ErrCode.ForbiddenUser);
        }

        // Try to setup a webhook
        if (gitlabConfig.webhook.publicUrl) {
            const hooks = await client.projects.hooks.list(project.id);
            const hasHook = hooks.find(h => h.url === gitlabConfig.webhook.publicUrl);
            if (!hasHook) {
                log.info(`Creating webhook for ${validData.path}`);
                await client.projects.hooks.add(project.id, {
                    url: gitlabConfig.webhook.publicUrl,
                    token: gitlabConfig.webhook.secret,
                    enable_ssl_verification: true,
                    // TODO: Determine which of these actually interests the user.
                    issues_events: true,
                    merge_requests_events: true,
                    push_events: true,
                    releases_events: true,
                    tag_push_events: true,
                    wiki_page_events: true,
                });
            }
        } else {
            log.info(`Not creating webhook, webhookUrl is not defined in config`);
        }

        const stateEventKey = `${validData.instance}/${validData.path}`;
        return {
            stateEventContent: validData,
            connection: new GitLabRepoConnection(roomId, stateEventKey, as, validData, tokenStore, instance),
        }
    }

    public static getProvisionerDetails(botUserId: string) {
        return {
            service: "gitlab",
            eventType: GitLabRepoConnection.CanonicalEventType,
            type: "GitLabRepo",
            botUserId,
        }
    }

    public static async getConnectionTargets(userId: string, tokenStore: UserTokenStore, config: BridgeConfigGitLab, filters: GitLabTargetFilter = {}): Promise<GitLabRepoConnectionTarget[]> {
        // Search for all repos under the user's control.

        if (!filters.instance) {
            const results: GitLabRepoConnectionInstanceTarget[] = [];
            for (const [name, instance] of Object.entries(config.instances)) {
                const client = await tokenStore.getGitLabForUser(userId, instance.url);
                if (client) {
                    results.push({
                        name,
                    } as GitLabRepoConnectionInstanceTarget);
                }
            }
            return results;
        }
        // If we have an instance, search under it.
        const instanceUrl = config.instances[filters.instance]?.url;
        const client = instanceUrl && await tokenStore.getGitLabForUser(userId, instanceUrl);
        if (!client) {
            throw new ApiError('Instance is not known or you do not have access to it.', ErrCode.NotFound);
        }
        const after = filters.after === undefined ? undefined : parseInt(filters.after, 10); 
        const allProjects = await client.projects.list(AccessLevel.Developer, filters.parent, after, filters.search);
        return allProjects.map(p => ({
            state: {
                instance: filters.instance,
                path: p.path_with_namespace,
            },
            name: p.name,
        })) as GitLabRepoConnectionProjectTarget[];
    }

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

    public getProvisionerDetails() {
        return {
            ...GitLabRepoConnection.getProvisionerDetails(this.as.botUserId),
            id: this.connectionId,
            config: {
                ...this.state,
            },
        }
    }

    @botCommand("create", "Create an issue for this repo", ["title"], ["description", "labels"], true)
    public async onCreateIssue(userId: string, title: string, description?: string, labels?: string) {
        const client = await this.tokenStore.getGitLabForUser(userId, this.instance.url);
        if (!client) {
            await this.as.botIntent.sendText(this.roomId, "You must be logged in to create an issue.", "m.notice");
            throw Error('Not logged in');
        }
        const res = await client.issues.create({
            id: this.path,
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
            id: this.state.path,
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
        if (this.shouldSkipHook('merge_request', 'merge_request.open') || !this.matchesLabelFilter(event)) {
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
        if (this.shouldSkipHook('merge_request', 'merge_request.close') || !this.matchesLabelFilter(event)) {
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
        if (this.shouldSkipHook('merge_request', 'merge_request.merge') || !this.matchesLabelFilter(event)) {
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
        if (this.shouldSkipHook('merge_request', 'merge_request.review', `merge_request.${event.object_attributes.action}`) || !this.matchesLabelFilter(event)) {
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
        const commitsurl = `${event.project.homepage}/-/commit/${event.after}`
        const branchurl = `${event.project.homepage}/-/tree/${branchname}`;
        const shouldName = !event.commits.every(c => c.author.name === event.commits[0]?.author.name);

        // Take the top 5 commits. The array is ordered in reverse.
        const commits = event.commits.reverse().slice(0,5).map(commit => {
            return `[${commit.id.slice(0,8)}](${event.project.homepage}/-/commit/${commit.id}) ${commit.title}${shouldName ? ` by ${commit.author.name}` : ""}`;
        }).join('\n - ');

        let content = `**${event.user_name}** pushed [${event.total_commits_count} commit${event.total_commits_count > 1 ? "s": ""}](${commitsurl})`
        + ` to [\`${branchname}\`](${branchurl}) for ${event.project.path_with_namespace}`;

        if (event.commits.length >= 2) {
            content += `\n - ${commits}\n`;
        } else if (event.commits.length === 1) {
            content += ` - ${commits}`;
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

    public async onCommentCreated(event: IGitLabWebhookNoteEvent) {
        if (this.shouldSkipHook('merge_request', 'merge_request.review', 'merge_request.review.comments')) {
            return;
        }
        log.info(`onCommentCreated ${this.roomId} ${this.toString()} ${event.merge_request?.iid} ${event.object_attributes.id}`);
        const uniqueId = `${event.merge_request?.iid}/${event.object_attributes.author_id}`;

        if (!event.merge_request || event.object_attributes.noteable_type !== "MergeRequest") {
            // Not a MR comment
            return;
        }

        if (event.object_attributes.author_id === event.merge_request.author_id) {
            // If it's the same author, ignore
            return;
        }

        const mergeRequest = event.merge_request;

        const renderFn = () => {
            const result = this.debounceMRComments.get(uniqueId);
            if (!result) {
                // Always defined, but for type checking purposes.
                return;
            }
            const orgRepoName = event.project.path_with_namespace;
            const comments = result.comments !== 1 ? `${result.comments} comments` : '1 comment';
            const content = `**${result.author}** reviewed MR [${orgRepoName}#${mergeRequest.iid}](${mergeRequest.url}): "${mergeRequest.title}" with ${comments}`;
            this.as.botIntent.sendEvent(this.roomId, {
                msgtype: "m.notice",
                body: content,
                formatted_body: md.renderInline(content),
                format: "org.matrix.custom.html",
            }).catch(ex  => {
                log.error('Failed to send onCommentCreated message', ex);
            });
        };

        const existing = this.debounceMRComments.get(uniqueId);
        if (existing) {
            clearTimeout(existing.timeout);
            existing.comments = existing.comments + 1;
            existing.timeout = setTimeout(renderFn, MRRCOMMENT_DEBOUNCE_MS);
        } else {
            this.debounceMRComments.set(uniqueId, {
                comments: 1,
                author: event.user.name,
                timeout: setTimeout(renderFn, MRRCOMMENT_DEBOUNCE_MS),
            })
        }

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

    private shouldSkipHook(...hookName: AllowedEventsNames[]) {
        if (this.state.ignoreHooks) {
            for (const name of hookName) {
                if (this.state.ignoreHooks?.includes(name)) {
                    return true;
                }
            }
        }
        return false;
    }

    public async provisionerUpdateConfig(userId: string, config: Record<string, unknown>) {
        const validatedConfig = validateState(config);
        await this.as.botClient.sendStateEvent(this.roomId, GitLabRepoConnection.CanonicalEventType, this.stateKey, validatedConfig
        );
    }


    public async onRemove() {
        log.info(`Removing ${this.toString()} for ${this.roomId}`);
        // Do a sanity check that the event exists.
        try {
            await this.as.botClient.getRoomStateEvent(this.roomId, GitLabRepoConnection.CanonicalEventType, this.stateKey);
            await this.as.botClient.sendStateEvent(this.roomId, GitLabRepoConnection.CanonicalEventType, this.stateKey, { disabled: true });
        } catch (ex) {
            await this.as.botClient.getRoomStateEvent(this.roomId, GitLabRepoConnection.LegacyCanonicalEventType, this.stateKey);
            await this.as.botClient.sendStateEvent(this.roomId, GitLabRepoConnection.LegacyCanonicalEventType, this.stateKey, { disabled: true });
        }
        // TODO: Clean up webhooks
    }
}

// Typescript doesn't understand Prototypes very well yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const res = compileBotCommands(GitLabRepoConnection.prototype as any, CommandConnection.prototype as any);
GitLabRepoConnection.helpMessage = res.helpMessage;
GitLabRepoConnection.botCommands = res.botCommands;
