// We need to instantiate some functions which are not directly called, which confuses typescript.
/* eslint-disable @typescript-eslint/ban-ts-comment */
import { UserTokenStore } from "../UserTokenStore";
import { Appservice, StateEvent } from "matrix-bot-sdk";
import { BotCommands, botCommand, compileBotCommands } from "../BotCommands";
import { MatrixEvent, MatrixMessageContent } from "../MatrixEvent";
import markdown from "markdown-it";
import { Logger } from "matrix-appservice-bridge";
import { BridgeConfigGitLab, GitLabInstance } from "../Config/Config";
import { IGitlabMergeRequest, IGitlabProject, IGitlabUser, IGitLabWebhookMREvent, IGitLabWebhookNoteEvent, IGitLabWebhookPushEvent, IGitLabWebhookReleaseEvent, IGitLabWebhookTagPushEvent, IGitLabWebhookWikiPageEvent } from "../Gitlab/WebhookTypes";
import { CommandConnection } from "./CommandConnection";
import { Connection, IConnection, IConnectionState, InstantiateConnectionOpts, ProvisionConnectionOpts } from "./IConnection";
import { ConnectionWarning, GetConnectionsResponseItem } from "../provisioning/api";
import { ErrCode, ApiError, ValidatorApiError } from "../api"
import { AccessLevel } from "../Gitlab/Types";
import Ajv, { JSONSchemaType } from "ajv";
import { CommandError } from "../errors";
import QuickLRU from "@alloc/quick-lru";
import { HookFilter } from "../HookFilter";

export interface GitLabRepoConnectionState extends IConnectionState {
    instance: string;
    path: string;
    ignoreHooks?: AllowedEventsNames[],
    includeCommentBody?: boolean;
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

const log = new Logger("GitLabRepoConnection");
const md = new markdown();

const PUSH_MAX_COMMITS = 5;
const MRRCOMMENT_DEBOUNCE_MS = 5000;


export type GitLabRepoResponseItem = GetConnectionsResponseItem<GitLabRepoConnectionState>;


type AllowedEventsNames = 
    "merge_request.open" |
    "merge_request.close" |
    "merge_request.merge" |
    "merge_request.review" |
    "merge_request.ready_for_review" |
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
    "merge_request.ready_for_review",
    "merge_request.review.comments",
    "merge_request",
    "tag_push",
    "push",
    "wiki",
    "release",
    "release.created",
];

const ConnectionStateSchema = {
    type: "object",
    properties: {
        priority: {
            type: "number",
            nullable: true,
        },
        instance: { type: "string" },
        path: { type: "string" },
        ignoreHooks: {
            type: "array",
            items: {
                type: "string",
            },
            nullable: true,
        },
        commandPrefix: {
            type: "string",
            minLength: 2,
            nullable: true,
            maxLength: 24,
        },
        pushTagsRegex: {
            type: "string",
            nullable: true,
            },
        includingLabels: {
            type: "array",
            nullable: true,
            items: {type: "string"},
        },
        excludingLabels: {
            type: "array",
            nullable: true,
            items: {type: "string"},
        },
        includeCommentBody: {
            type: "boolean",
            nullable: true,
        },
    },
    required: [
      "instance",
      "path"
    ],
    additionalProperties: true
} as JSONSchemaType<GitLabRepoConnectionState>;

export interface GitLabTargetFilter {
    instance?: string;
    parent?: string;
    after?: string;
    search?: string;
}

/**
 * Handles rooms connected to a GitLab repo.
 */
@Connection
export class GitLabRepoConnection extends CommandConnection<GitLabRepoConnectionState> implements IConnection {
    static readonly CanonicalEventType = "uk.half-shot.matrix-hookshot.gitlab.repository";
    static readonly LegacyCanonicalEventType = "uk.half-shot.matrix-github.gitlab.repository";

    static readonly EventTypes = [
        GitLabRepoConnection.CanonicalEventType,
        GitLabRepoConnection.LegacyCanonicalEventType,
    ];
    
    static botCommands: BotCommands;
    static helpMessage: (cmdPrefix?: string | undefined) => MatrixMessageContent;
    static ServiceCategory = "gitlab";

	static validateState(state: unknown, isExistingState = false): GitLabRepoConnectionState {
        const validator = new Ajv({ strict: false }).compile(ConnectionStateSchema);
        if (validator(state)) {
            // Validate ignoreHooks IF this is an incoming update (we can be less strict for existing state)
            if (!isExistingState && state.ignoreHooks && !state.ignoreHooks.every(h => AllowedEvents.includes(h))) {
                throw new ApiError('`ignoreHooks` must only contain allowed values', ErrCode.BadValue);
            }
            return state;
        }
        throw new ValidatorApiError(validator.errors);
    }

    static async createConnectionForState(roomId: string, event: StateEvent<Record<string, unknown>>, {as, tokenStore, config}: InstantiateConnectionOpts) {
        if (!config.gitlab) {
            throw Error('GitLab is not configured');
        }
        const state = this.validateState(event.content, true);
        const instance = config.gitlab.instances[state.instance];
        if (!instance) {
            throw Error('Instance name not recognised');
        }
        return new GitLabRepoConnection(roomId, event.stateKey, as, state, tokenStore, instance);
    }

    public static async provisionConnection(roomId: string, requester: string, data: Record<string, unknown>, { config, as, tokenStore, getAllConnectionsOfType }: ProvisionConnectionOpts) {
        if (!config.gitlab) {
            throw Error('GitLab is not configured');
        }
        const gitlabConfig = config.gitlab;
        const validData = this.validateState(data);
        const instance = gitlabConfig.instances[validData.instance];
        if (!instance) {
            throw Error(`provisionConnection provided an instanceName of ${validData.instance} but the instance does not exist`);
        }
        const client = await tokenStore.getGitLabForUser(requester, instance.url);
        if (!client) {
            throw new ApiError("User is not authenticated with GitLab", ErrCode.ForbiddenUser);
        }
        let permissionLevel;
        try {
            permissionLevel = await client.projects.getMyAccessLevel(validData.path);
        } catch (ex) {
            throw new ApiError("Could not determine if the user has access to this project, does the project exist?", ErrCode.ForbiddenUser);
        }

        if (permissionLevel < AccessLevel.Developer) {
            throw new ApiError("You must at least have developer access to bridge this project", ErrCode.ForbiddenUser);
        }
        
        const project = await client.projects.get(validData.path);

        const stateEventKey = `${validData.instance}/${validData.path}`;
        const connection = new GitLabRepoConnection(roomId, stateEventKey, as, validData, tokenStore, instance);
        const existingConnections = getAllConnectionsOfType(GitLabRepoConnection);
        const existing = existingConnections.find(c => c.roomId === roomId && c.path === connection.path);

        if (existing) {
            throw new ApiError("A GitLab repo connection for this project already exists", ErrCode.ConflictingConnection, -1, {
                existingConnection: existing.getProvisionerDetails()
            });
        }

        // Try to set up a webhook
        // Requires at least a "Maintainer" role: https://docs.gitlab.com/ee/user/permissions.html
        let warning: ConnectionWarning | undefined;
        if (gitlabConfig.webhook.publicUrl && permissionLevel >= AccessLevel.Maintainer) {
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
        } else if (!gitlabConfig.webhook.publicUrl) {
            log.info(`Not creating webhook, webhookUrl is not defined in config`);
        } else {
            warning = {
                header: "Cannot create webhook",
                message: "You have insufficient permissions on this project to provision a webhook for it. Ask a Maintainer or Owner of the project to add the webhook for you.",
            };
            log.warn(`Not creating webhook, permission level is insufficient (${permissionLevel} < ${AccessLevel.Maintainer})`)
        }
        await as.botIntent.underlyingClient.sendStateEvent(roomId, this.CanonicalEventType, connection.stateKey, validData);
        return {connection, warning};
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
                    });
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

    private readonly debounceMRComments = new Map<string, {
        commentCount: number,
        commentNotes?: string[],
        author: string,
        timeout: NodeJS.Timeout,
        approved?: boolean,
        skip?: boolean,
    }>();

    /**
     * GitLab provides NO threading information in its webhook response objects,
     * so we need to determine if we've seen a comment for a line before, and
     * skip it if we have (because it's probably a reply).
     */
    private readonly mergeRequestSeenDiscussionIds = new QuickLRU<string, undefined>({ maxSize: 100 });
    private readonly hookFilter: HookFilter<AllowedEventsNames>;

    constructor(roomId: string,
        stateKey: string,
        private readonly as: Appservice,
        state: GitLabRepoConnectionState,
        private readonly tokenStore: UserTokenStore,
        private readonly instance: GitLabInstance) {
            super(
                roomId,
                stateKey,
                GitLabRepoConnection.CanonicalEventType,
                state,
                as.botClient,
                GitLabRepoConnection.botCommands,
                GitLabRepoConnection.helpMessage,
                "!gl",
                "gitlab",
            )
            if (!state.path || !state.instance) {
                throw Error('Invalid state, missing `path` or `instance`');
            }
            this.hookFilter = new HookFilter(
                // GitLab allows all events by default
                AllowedEvents,
                [],
                state.ignoreHooks,
            );
    }

    public get path() {
        return this.state.path.toLowerCase();
    }

    /**
     * The project's path string as returned by GitLab,
     * with the letter casing of the path that the
     * project was created with.
     */
    public get prettyPath() {
        return this.state.path;
    }

    public get priority(): number {
        return this.state.priority || super.priority;
    }

    protected validateConnectionState(content: unknown) {
        return GitLabRepoConnection.validateState(content);
    }

    public isInterestedInStateEvent(eventType: string, stateKey: string) {
        return GitLabRepoConnection.EventTypes.includes(eventType) && this.stateKey === stateKey;
    }

    public async onStateUpdate(stateEv: MatrixEvent<unknown>) {
        await super.onStateUpdate(stateEv);
        this.hookFilter.ignoredHooks = this.state.ignoreHooks ?? [];
    }

    public getProvisionerDetails(): GitLabRepoResponseItem {
        return {
            ...GitLabRepoConnection.getProvisionerDetails(this.as.botUserId),
            id: this.connectionId,
            config: {
                ...this.state,
            },
        }
    }

    private async getClientForUser(userId: string) {
        const client = await this.tokenStore.getGitLabForUser(userId, this.instance.url);
        if (!client) {
            throw new CommandError('User is not logged into GitLab', 'You must be logged in to create an issue.');
        }
        return client;
    }

    @botCommand("create", "Create an issue for this repo", ["title"], ["description", "labels"], true)
    public async onCreateIssue(userId: string, title: string, description?: string, labels?: string) {
        const client = await this.getClientForUser(userId);
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

    @botCommand("create-confidential", "Create a confidental issue for this repo", ["title"], ["description", "labels"], true)
    public async onCreateConfidentialIssue(userId: string, title: string, description?: string, labels?: string) {
        const client = await this.getClientForUser(userId);
        const res = await client.issues.create({
            id: this.path,
            title,
            description,
            confidential: true,
            labels: labels ? labels.split(",") : undefined,
        });

        const content = `Created confidential issue #${res.iid}: [${res.web_url}](${res.web_url})`;
        return this.as.botIntent.sendEvent(this.roomId,{
            msgtype: "m.notice",
            body: content,
            formatted_body: md.render(content),
            format: "org.matrix.custom.html"
        });
    }

    @botCommand("close", "Close an issue", ["number"], ["comment"], true)
    public async onClose(userId: string, number: string) {
        const client = await this.getClientForUser(userId);

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
        if (this.hookFilter.shouldSkip('merge_request', 'merge_request.open') || !this.matchesLabelFilter(event)) {
            return;
        }
        log.info(`onMergeRequestOpened ${this.roomId} ${this.path} #${event.object_attributes.iid}`);
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
        if (this.hookFilter.shouldSkip('merge_request', 'merge_request.close') || !this.matchesLabelFilter(event)) {
            return;
        }
        log.info(`onMergeRequestClosed ${this.roomId} ${this.path} #${event.object_attributes.iid}`);
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
        if (this.hookFilter.shouldSkip('merge_request', 'merge_request.merge') || !this.matchesLabelFilter(event)) {
            return;
        }
        log.info(`onMergeRequestMerged ${this.roomId} ${this.path} #${event.object_attributes.iid}`);
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

    public async onMergeRequestUpdate(event: IGitLabWebhookMREvent) {
        if (this.hookFilter.shouldSkip('merge_request', 'merge_request.ready_for_review')) {
            return;
        }
        log.info(`onMergeRequestUpdate ${this.roomId} ${this.instance}/${this.path} ${event.object_attributes.iid}`);
        this.validateMREvent(event);
        // Check if the MR changed to / from a draft
        if (!event.changes.title) {
            return;
        }
        const orgRepoName = event.project.path_with_namespace;
        let content: string;
        const wasDraft = event.changes.title.before.startsWith('Draft: ');
        const isDraft = event.changes.title.after.startsWith('Draft: ');
        if (wasDraft && !isDraft) {
            // Ready for review
            content = `**${event.user.username}** marked MR [${orgRepoName}#${event.object_attributes.iid}](${event.object_attributes.url}) as ready for review "${event.object_attributes.title}" `;
        } else if (!wasDraft && isDraft) {
            // Back to draft.
            content = `**${event.user.username}** marked MR [${orgRepoName}#${event.object_attributes.iid}](${event.object_attributes.url}) as draft "${event.object_attributes.title}" `;
        } else {
            // Nothing changed, drop it.
            return;
        }
        await this.as.botIntent.sendEvent(this.roomId, {
            msgtype: "m.notice",
            body: content,
            formatted_body: md.renderInline(content),
            format: "org.matrix.custom.html",
        });
    }

    public async onGitLabTagPush(event: IGitLabWebhookTagPushEvent) {
        if (this.hookFilter.shouldSkip('tag_push')) {
            return;
        }
        log.info(`onGitLabTagPush ${this.roomId} ${this.instance.url}/${this.path} ${event.ref}`);
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
        if (this.hookFilter.shouldSkip('push')) {
            return;
        }
        log.info(`onGitLabPush ${this.roomId} ${this.instance.url}/${this.path} ${event.after}`);
        const branchname = event.ref.replace("refs/heads/", "");
        const commitsurl = `${event.project.homepage}/-/commits/${branchname}`;
        const branchurl = `${event.project.homepage}/-/tree/${branchname}`;
        const shouldName = !event.commits.every(c => c.author.email === event.user_email);

        const tooManyCommits = event.total_commits_count > PUSH_MAX_COMMITS;
        const displayedCommits = tooManyCommits ? 1 : Math.min(event.total_commits_count, PUSH_MAX_COMMITS);
        
        // Take the top 5 commits. The array is ordered in reverse.
        const commits = event.commits.reverse().slice(0,displayedCommits).map(commit => {
            return `[\`${commit.id.slice(0,8)}\`](${event.project.homepage}/-/commit/${commit.id}) ${commit.title}${shouldName ? ` by ${commit.author.name}` : ""}`;
        }).join('\n - ');

        let content = `**${event.user_name}** pushed [${event.total_commits_count} commit${event.total_commits_count > 1 ? "s": ""}](${commitsurl})`
        + ` to [\`${branchname}\`](${branchurl}) for ${event.project.path_with_namespace}`;

        if (displayedCommits >= 2) {
            content += `\n - ${commits}\n`;
        } else if (displayedCommits === 1) {
            content += `: ${commits}`;
            if (tooManyCommits) {
                content += `, and [${event.total_commits_count - 1} more](${commitsurl}) commits`;
            }
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
        if (this.hookFilter.shouldSkip('wiki', `wiki.${attributes.action}`)) {
            return;
        }
        log.info(`onWikiPageEvent ${this.roomId} ${this.instance}/${this.path}`);

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
        if (this.hookFilter.shouldSkip('release', 'release.created')) {
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

    private renderDebouncedMergeRequest(uniqueId: string, mergeRequest: IGitlabMergeRequest, project: IGitlabProject) {
        const result = this.debounceMRComments.get(uniqueId);
        if (!result) {
            // Always defined, but for type checking purposes.
            return;
        }
        // Delete after use.
        this.debounceMRComments.delete(uniqueId);
        const orgRepoName = project.path_with_namespace;
        let comments = '';
        if (result.commentCount === 1) {
            comments = ' with one comment';
        } else if (result.commentCount > 1) {
            comments = ` with ${result.commentCount} comments`;
        }

        let approvalState = 'commented on';
        if (result.approved === true) {
            approvalState = '✅ approved'
        } else if (result.approved === false) {
            approvalState = '🔴 unapproved';
        }

        let content = `**${result.author}** ${approvalState} MR [${orgRepoName}#${mergeRequest.iid}](${mergeRequest.url}): "${mergeRequest.title}"${comments}`;

        if (result.commentNotes) {
            content += "\n\n> " + result.commentNotes.join("\n\n> ");
        }

        this.as.botIntent.sendEvent(this.roomId, {
            msgtype: "m.notice",
            body: content,
            formatted_body: md.renderInline(content),
            format: "org.matrix.custom.html",
        }).catch(ex  => {
            log.error('Failed to send MR review message', ex);
        });
    }

    private debounceMergeRequestReview(
        user: IGitlabUser,
        mergeRequest: IGitlabMergeRequest,
        project: IGitlabProject,
        opts: {
            commentCount: number,
            commentNotes?: string[],
            approved?: boolean,
            /**
             * If the MR contains only comments, skip it.
             */
            skip: boolean,
        }
    ) {
        const { commentCount, commentNotes, approved } = opts;
        const uniqueId = `${mergeRequest?.iid}/${user.username}`;
        const existing = this.debounceMRComments.get(uniqueId);
        if (existing) {
            clearTimeout(existing.timeout);
            existing.approved = approved;
            if (commentNotes) {
                existing.commentNotes = [...(existing.commentNotes ?? []), ...commentNotes];
            }
            existing.commentCount += opts.commentCount;
            if (!opts.skip) {
                existing.skip = false;
            }
            existing.timeout = setTimeout(() => this.renderDebouncedMergeRequest(uniqueId, mergeRequest, project), MRRCOMMENT_DEBOUNCE_MS);
            return;
        }
        this.debounceMRComments.set(uniqueId, {
            commentCount: commentCount,
            commentNotes: commentNotes,
            skip: opts.skip,
            approved,
            author: user.name,
            timeout: setTimeout(() => this.renderDebouncedMergeRequest(uniqueId, mergeRequest, project), MRRCOMMENT_DEBOUNCE_MS),
        });
    }

    public async onMergeRequestReviewed(event: IGitLabWebhookMREvent) {
        if (this.hookFilter.shouldSkip('merge_request', 'merge_request.review', `merge_request.${event.object_attributes.action}`) || !this.matchesLabelFilter(event)) {
            return;
        }
        log.info(`onMergeRequestReviewed ${this.roomId} ${this.instance}/${this.path} ${event.object_attributes.iid}`);
        this.validateMREvent(event);
        if (event.object_attributes.action !== "approved" && event.object_attributes.action !== "unapproved") {
            // Not interested.
            return;
        }
        this.debounceMergeRequestReview(
            event.user,
            event.object_attributes, 
            event.project,
            {
                commentCount: 0,
                approved: "approved" === event.object_attributes.action,
                skip: false,
            }
        );
    }

    private shouldHandleMRComment(event: IGitLabWebhookNoteEvent) {
        // Check to see if this line has had a comment before
        if (event.object_attributes.discussion_id) {
            if (this.mergeRequestSeenDiscussionIds.has(event.object_attributes.discussion_id)) {
                // If it has, this is probably a reply. Skip repeated replies.
                return false;
            }
            // Otherwise, record that we have seen the line and continue (it's probably a genuine comment).
            this.mergeRequestSeenDiscussionIds.set(event.object_attributes.discussion_id, undefined);
        }
        return true;
    }

    public async onCommentCreated(event: IGitLabWebhookNoteEvent) {
        if (this.hookFilter.shouldSkip('merge_request', 'merge_request.review')) {
            return;
        }
        log.info(`onCommentCreated ${this.roomId} ${this.toString()} ${event.merge_request?.iid} ${event.object_attributes.id}`);
        if (!event.merge_request || event.object_attributes.noteable_type !== "MergeRequest") {
            // Not a MR comment
            return;
        }
        if (!this.shouldHandleMRComment(event)) {
            // Skip it.
            return;
        }
        this.debounceMergeRequestReview(event.user, event.merge_request, event.project, {
            commentCount: 1,
            commentNotes: this.state.includeCommentBody ? [event.object_attributes.note] : undefined,
            skip: this.hookFilter.shouldSkip('merge_request.review.comments'),
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

    public async provisionerUpdateConfig(userId: string, config: Record<string, unknown>) {
        // Apply previous state to the current config, as provisioners might not return "unknown" keys.
        config = { ...this.state, ...config };
        const validatedConfig = GitLabRepoConnection.validateState(config);
        await this.as.botClient.sendStateEvent(this.roomId, GitLabRepoConnection.CanonicalEventType, this.stateKey, validatedConfig);
        this.state = validatedConfig;
        this.hookFilter.ignoredHooks = this.state.ignoreHooks ?? [];
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
