import { UserTokenStore } from "../tokens/UserTokenStore";
import { Appservice, Intent, StateEvent } from "matrix-bot-sdk";
import { BotCommands, botCommand, compileBotCommands } from "../BotCommands";
import { MatrixEvent, MatrixMessageContent } from "../MatrixEvent";
import markdown from "markdown-it";
import { Logger } from "matrix-appservice-bridge";
import { BridgeConfigGitLab, GitLabInstance } from "../config/Config";
import { IGitlabMergeRequest, IGitlabProject, IGitlabUser, IGitLabWebhookMREvent, IGitLabWebhookNoteEvent, IGitLabWebhookPushEvent, IGitLabWebhookReleaseEvent, IGitLabWebhookTagPushEvent, IGitLabWebhookWikiPageEvent } from "../Gitlab/WebhookTypes";
import { CommandConnection } from "./CommandConnection";
import { Connection, IConnection, IConnectionState, InstantiateConnectionOpts, ProvisionConnectionOpts } from "./IConnection";
import { ConnectionWarning, GetConnectionsResponseItem } from "../provisioning/api";
import { ErrCode, ApiError, ValidatorApiError } from "../api"
import { AccessLevel, SerializedGitlabDiscussionThreads } from "../Gitlab/Types";
import Ajv, { JSONSchemaType } from "ajv";
import { CommandError } from "../errors";
import QuickLRU from "@alloc/quick-lru";
import { HookFilter } from "../HookFilter";
import { GitLabClient } from "../Gitlab/Client";
import { IBridgeStorageProvider } from "../Stores/StorageProvider";
import axios from "axios";
import { GitLabGrantChecker } from "../Gitlab/GrantChecker";

export interface GitLabRepoConnectionState extends IConnectionState {
    instance: string;
    path: string;
    enableHooks?: AllowedEventsNames[],
    /**
     * Do not use. Use `enableHooks`
     * @deprecated
     */
    ignoreHooks?: AllowedEventsNames[],
    includeCommentBody?: boolean;
    pushTagsRegex?: string,
    includingLabels?: string[];
    excludingLabels?: string[];
}

interface ConnectionStateValidated extends GitLabRepoConnectionState {
    ignoreHooks: undefined,
    enableHooks: AllowedEventsNames[],
}


export interface GitLabRepoConnectionInstanceTarget {
    name: string;
}
export interface GitLabRepoConnectionProjectTarget {
    state: GitLabRepoConnectionState;
    name: string;
    avatar_url?: string;
    description?: string;
}

export type GitLabRepoConnectionTarget = GitLabRepoConnectionInstanceTarget|GitLabRepoConnectionProjectTarget;

const log = new Logger("GitLabRepoConnection");
const md = new markdown();

const PUSH_MAX_COMMITS = 5;

export type GitLabRepoResponseItem = GetConnectionsResponseItem<GitLabRepoConnectionState>;


type AllowedEventsNames =
    "merge_request.open" |
    "merge_request.reopen" |
    "merge_request.close" |
    "merge_request.merge" |
    "merge_request.review" |
    "merge_request.review.individual" |
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
    "merge_request.reopen",
    "merge_request.close",
    "merge_request.merge",
    "merge_request.review",
    "merge_request.review.individual",
    "merge_request.ready_for_review",
    "merge_request.review.comments",
    "merge_request",
    "tag_push",
    "push",
    "wiki",
    "release",
    "release.created",
];

const DefaultHooks = AllowedEvents;

const ConnectionStateSchema = {
    type: "object",
    properties: {
        priority: {
            type: "number",
            nullable: true,
        },
        instance: { type: "string" },
        path: { type: "string" },
        /**
         * Do not use. Use `enableHooks`
         * @deprecated
         */
        ignoreHooks: {
            type: "array",
            items: {
                type: "string",
            },
            nullable: true,
        },
        enableHooks: {
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
    search?: string;
}

/**
 * Handles rooms connected to a GitLab repo.
 */
@Connection
export class GitLabRepoConnection extends CommandConnection<GitLabRepoConnectionState, ConnectionStateValidated> implements IConnection {
    static readonly CanonicalEventType = "uk.half-shot.matrix-hookshot.gitlab.repository";
    static readonly LegacyCanonicalEventType = "uk.half-shot.matrix-github.gitlab.repository";

    static readonly EventTypes = [
        GitLabRepoConnection.CanonicalEventType,
        GitLabRepoConnection.LegacyCanonicalEventType,
    ];

    static botCommands: BotCommands;
    static helpMessage: (cmdPrefix?: string | undefined) => MatrixMessageContent;
    static ServiceCategory = "gitlab";

	static validateState(state: unknown, isExistingState = false): ConnectionStateValidated {
        const validator = new Ajv({ strict: false }).compile(ConnectionStateSchema);
        if (validator(state)) {
            // Validate enableHooks IF this is an incoming update (we can be less strict for existing state)
            if (!isExistingState && state.enableHooks && !state.enableHooks.every(h => AllowedEvents.includes(h))) {
                throw new ApiError('`enableHooks` must only contain allowed values', ErrCode.BadValue);
            }
            if (state.ignoreHooks) {
                if (!isExistingState) {
                    throw new ApiError('`ignoreHooks` cannot be used with new connections', ErrCode.BadValue);
                }
                log.warn(`Room has old state key 'ignoreHooks'. Converting to compatible enabledHooks filter`);
                state.enableHooks = HookFilter.convertIgnoredHooksToEnabledHooks(state.enableHooks, state.ignoreHooks, AllowedEvents);
            }
            return {
                ...state,
                enableHooks: state.enableHooks ?? AllowedEvents,
                ignoreHooks: undefined,
            };
        }
        throw new ValidatorApiError(validator.errors);
    }

    static async createConnectionForState(roomId: string, event: StateEvent<Record<string, unknown>>, {as, intent, storage, tokenStore, config}: InstantiateConnectionOpts) {
        if (!config.gitlab) {
            throw Error('GitLab is not configured');
        }
        const state = this.validateState(event.content, true);
        const instance = config.gitlab.instances[state.instance];
        if (!instance) {
            throw Error('Instance name not recognised');
        }

        const connection = new GitLabRepoConnection(roomId, event.stateKey, as, config.gitlab, intent, state, tokenStore, instance, storage);

        const discussionThreads = await storage.getGitlabDiscussionThreads(connection.connectionId);
        connection.setDiscussionThreads(discussionThreads);

        return connection;
    }

    public static async assertUserHasAccessToProject(
        instanceName: string, path: string, requester: string,
        tokenStore: UserTokenStore, config: BridgeConfigGitLab
    ) {
        const instance = config.instances[instanceName];
        if (!instance) {
            throw Error(`provisionConnection provided an instanceName of ${instanceName} but the instance does not exist`);
        }
        const client = await tokenStore.getGitLabForUser(requester, instance.url);
        if (!client) {
            throw new ApiError("User is not authenticated with GitLab", ErrCode.ForbiddenUser);
        }
        let permissionLevel;
        try {
            permissionLevel = await client.projects.getMyAccessLevel(path);
        } catch (ex) {
            throw new ApiError("Could not determine if the user has access to this project, does the project exist?", ErrCode.ForbiddenUser);
        }

        if (permissionLevel < AccessLevel.Developer) {
            throw new ApiError("You must at least have developer access to bridge this project", ErrCode.ForbiddenUser);
        }
        return permissionLevel;
    }

    public static async provisionConnection(
        roomId: string,
        requester: string,
        data: Record<string, unknown>,
        { as, config, intent, storage, tokenStore, getAllConnectionsOfType }: ProvisionConnectionOpts
    ) {
        if (!config.gitlab) {
            throw Error('GitLab is not configured');
        }
        const validData = this.validateState(data);
        const gitlabConfig = config.gitlab;
        const instance = gitlabConfig.instances[validData.instance];
        if (!instance) {
            throw Error(`provisionConnection provided an instanceName of ${validData.instance} but the instance does not exist`);
        }
        const permissionLevel = await this.assertUserHasAccessToProject(validData.instance, validData.path, requester, tokenStore, gitlabConfig);
        const client = await tokenStore.getGitLabForUser(requester, instance.url);
        if (!client) {
            throw new ApiError("User is not authenticated with GitLab", ErrCode.ForbiddenUser);
        }

        const project = await client.projects.get(validData.path);
        const stateEventKey = `${validData.instance}/${validData.path}`;
        const connection = new GitLabRepoConnection(roomId, stateEventKey, as, gitlabConfig, intent, validData, tokenStore, instance, storage);

        const existingConnections = getAllConnectionsOfType(GitLabRepoConnection);
        const existing = existingConnections.find(c => c.roomId === roomId && c.instance.url === connection.instance.url && c.path === connection.path);

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
        await new GitLabGrantChecker(as, gitlabConfig, tokenStore).grantConnection(roomId, { instance: validData.instance, path: validData.path })
        await intent.underlyingClient.sendStateEvent(roomId, this.CanonicalEventType, connection.stateKey, validData);
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

    public static async getBase64Avatar(avatarUrl: string, client: GitLabClient, storage: IBridgeStorageProvider): Promise<string|null> {
        try {
            const existingFile = await storage.getStoredTempFile(avatarUrl);
            if (existingFile) {
                return existingFile;
            }
            const res = await client.get(avatarUrl);
            if (res.status !== 200) {
                return null;
            }
            const contentType = res.headers["content-type"];
            if (!contentType?.startsWith("image/")) {
                return null;
            }
            const data = res.data as Buffer;
            const url = `data:${contentType};base64,${data.toString('base64')}`;
            await storage.setStoredTempFile(avatarUrl, url);
            return url;
        } catch (ex) {
            if (axios.isAxiosError(ex)) {
                if (ex.response?.status === 401) {
                    // 401 means that the project is Private and GitLab haven't fixed
                    // the auth issues, just ignore this one.
                    // https://gitlab.com/gitlab-org/gitlab/-/issues/25498
                    return null;
                }
            }
            log.warn(`Could not transform data from ${avatarUrl} into base64`, ex);
            return null;
        }
    }

    public static async getConnectionTargets(userId: string, config: BridgeConfigGitLab, filters: GitLabTargetFilter = {}, tokenStore: UserTokenStore, storage: IBridgeStorageProvider): Promise<GitLabRepoConnectionTarget[]> {
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
        const allProjects = await client.projects.list(AccessLevel.Developer, filters.parent, undefined, filters.search);
        return await Promise.all(allProjects.map(async p => ({
            state: {
                instance: filters.instance,
                path: p.path_with_namespace,
            },
            name: p.name,
            avatar_url: p.avatar_url && await this.getBase64Avatar(p.avatar_url, client, storage),
            description: p.description,
        }))) as GitLabRepoConnectionProjectTarget[];
    }

    private readonly debounceMRComments = new Map<string, {
        commentCount: number,
        commentNotes?: string[],
        discussions: string[],
        author: string,
        timeout: NodeJS.Timeout,
        approved?: boolean,
        skip?: boolean,
    }>();

    private readonly discussionThreads = new QuickLRU<string, Promise<string|undefined>>({ maxSize: 100});

    private readonly hookFilter: HookFilter<AllowedEventsNames>;

    private readonly grantChecker;
    private readonly commentDebounceMs: number;

    constructor(
        roomId: string,
        stateKey: string,
        as: Appservice,
        config: BridgeConfigGitLab,
        private readonly intent: Intent,
        state: ConnectionStateValidated,
        private readonly tokenStore: UserTokenStore,
        private readonly instance: GitLabInstance,
        private readonly storage: IBridgeStorageProvider,
    ) {
        super(
            roomId,
            stateKey,
            GitLabRepoConnection.CanonicalEventType,
            state,
            intent.underlyingClient,
            GitLabRepoConnection.botCommands,
            GitLabRepoConnection.helpMessage,
            ["gitlab"],
            "!gl",
            "gitlab",
        )
        this.grantChecker = new GitLabGrantChecker(as, config, tokenStore);
        if (!state.path || !state.instance) {
            throw Error('Invalid state, missing `path` or `instance`');
        }
        this.hookFilter = new HookFilter(
            state.enableHooks ?? DefaultHooks,
        );
        this.commentDebounceMs = config.commentDebounceMs;
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
        const validatedState = GitLabRepoConnection.validateState(stateEv.content);
        await this.grantChecker.assertConnectionGranted(this.roomId, {
            instance: validatedState.instance,
            path: validatedState.path,
        } , stateEv.sender);
        await super.onStateUpdate(stateEv);
        this.hookFilter.enabledHooks = this.state.enableHooks;
    }

    public getProvisionerDetails(): GitLabRepoResponseItem {
        return {
            ...GitLabRepoConnection.getProvisionerDetails(this.intent.userId),
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
        return this.intent.sendEvent(this.roomId,{
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
        return this.intent.sendEvent(this.roomId,{
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
        log.info(`onMergeRequestOpened ${this.roomId} ${this.path} !${event.object_attributes.iid}`);
        this.validateMREvent(event);
        const orgRepoName = event.project.path_with_namespace;
        const content = `**${event.user.username}** opened a new MR [${orgRepoName}!${event.object_attributes.iid}](${event.object_attributes.url}): "${event.object_attributes.title}"`;
        await this.intent.sendEvent(this.roomId, {
            msgtype: "m.notice",
            body: content,
            formatted_body: md.renderInline(content),
            format: "org.matrix.custom.html",
        });
    }

    public async onMergeRequestReopened(event: IGitLabWebhookMREvent) {
        if (this.hookFilter.shouldSkip('merge_request', 'merge_request.reopen') || !this.matchesLabelFilter(event)) {
            return;
        }
        log.info(`onMergeRequestReopened ${this.roomId} ${this.path} !${event.object_attributes.iid}`);
        this.validateMREvent(event);
        const orgRepoName = event.project.path_with_namespace;
        const content = `**${event.user.username}** reopened MR [${orgRepoName}!${event.object_attributes.iid}](${event.object_attributes.url}): "${event.object_attributes.title}"`;
        await this.intent.sendEvent(this.roomId, {
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
        log.info(`onMergeRequestClosed ${this.roomId} ${this.path} !${event.object_attributes.iid}`);
        this.validateMREvent(event);
        const orgRepoName = event.project.path_with_namespace;
        const content = `**${event.user.username}** closed MR [${orgRepoName}!${event.object_attributes.iid}](${event.object_attributes.url}): "${event.object_attributes.title}"`;
        await this.intent.sendEvent(this.roomId, {
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
        log.info(`onMergeRequestMerged ${this.roomId} ${this.path} !${event.object_attributes.iid}`);
        this.validateMREvent(event);
        const orgRepoName = event.project.path_with_namespace;
        const content = `**${event.user.username}** merged MR [${orgRepoName}!${event.object_attributes.iid}](${event.object_attributes.url}): "${event.object_attributes.title}"`;
        await this.intent.sendEvent(this.roomId, {
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
        log.info(`onMergeRequestUpdate ${this.roomId} ${this.instance}/${this.path} !${event.object_attributes.iid}`);
        this.validateMREvent(event);
        // Check if the MR changed to / from a draft
        if (!event.changes.draft) {
            return;
        }
        const orgRepoName = event.project.path_with_namespace;
        let content: string;
        const isDraft = event.changes.draft.current;
        if (!isDraft) {
            // Ready for review
            content = `**${event.user.username}** marked MR [${orgRepoName}!${event.object_attributes.iid}](${event.object_attributes.url}) as ready for review "${event.object_attributes.title}" `;
        } else {
            // Back to draft.
            content = `**${event.user.username}** marked MR [${orgRepoName}!${event.object_attributes.iid}](${event.object_attributes.url}) as draft "${event.object_attributes.title}" `;
        }
        await this.intent.sendEvent(this.roomId, {
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
        await this.intent.sendEvent(this.roomId, {
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

        await this.intent.sendEvent(this.roomId, {
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
        await this.intent.sendEvent(this.roomId, {
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
        await this.intent.sendEvent(this.roomId, {
            msgtype: "m.notice",
            body: content,
            formatted_body: md.render(content),
            format: "org.matrix.custom.html",
        });
    }

    private async renderDebouncedMergeRequest(uniqueId: string, mergeRequest: IGitlabMergeRequest, project: IGitlabProject) {
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

        let relation;
        const discussionWithThread = result.discussions.find(discussionId => this.discussionThreads.has(discussionId));
        if (discussionWithThread) {
            const threadEventId = await this.discussionThreads.get(discussionWithThread)?.catch(() => { /* already logged */ });
            if (threadEventId) {
                relation = {
                    "m.relates_to": {
                        "event_id": threadEventId,
                        "rel_type": "m.thread"
                    },
                };
            }
        }

        let action = relation ? 'replied' : 'commented on'; // this is the only place we need this, approve/unapprove don't appear in discussions
        if (result.approved === true) {
            action = '✅ approved'
        } else if (result.approved === false) {
            action = '🔴 unapproved';
        }

        const target = relation ? '' : ` MR [${orgRepoName}!${mergeRequest.iid}](${mergeRequest.url}): "${mergeRequest.title}"`;
        let content = `**${result.author}** ${action}${target} ${comments}`;

        let formatted = '';
        if (result.commentNotes) {
            content += "\n\n> " + result.commentNotes.join("\n\n> ");
            formatted = md.render(content);
        } else {
            formatted = md.renderInline(content);
        }

        const eventPromise = this.intent.sendEvent(this.roomId, {
            msgtype: "m.notice",
            body: content,
            formatted_body: formatted,
            format: "org.matrix.custom.html",
            ...relation,
        }).catch(ex  => {
            log.error('Failed to send MR review message', ex);
            return undefined;
        });

        for (const discussionId of result.discussions) {
            if (!this.discussionThreads.has(discussionId)) {
                this.discussionThreads.set(discussionId, eventPromise);
            }
        }
        void this.persistDiscussionThreads().catch(ex => {
            log.error(`Failed to persistently store Gitlab discussion threads for connection ${this.connectionId}:`, ex);
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
            discussionId?: string,
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
            if (opts.discussionId) {
                existing.discussions.push(opts.discussionId);
            }
            existing.timeout = setTimeout(() => this.renderDebouncedMergeRequest(uniqueId, mergeRequest, project), this.commentDebounceMs);
            return;
        }
        this.debounceMRComments.set(uniqueId, {
            commentCount: commentCount,
            commentNotes: commentNotes,
            discussions: opts.discussionId ? [opts.discussionId] : [],
            skip: opts.skip,
            approved,
            author: user.name,
            timeout: setTimeout(() => this.renderDebouncedMergeRequest(uniqueId, mergeRequest, project), this.commentDebounceMs),
        });
    }

    public async onMergeRequestReviewed(event: IGitLabWebhookMREvent) {
        if (this.hookFilter.shouldSkip('merge_request', 'merge_request.review', `merge_request.${event.object_attributes.action}`) || !this.matchesLabelFilter(event)) {
            return;
        }
        log.info(`onMergeRequestReviewed ${this.roomId} ${this.instance}/${this.path} !${event.object_attributes.iid}`);
        this.validateMREvent(event);
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


    public async onMergeRequestIndividualReview(event: IGitLabWebhookMREvent) {
        if (this.hookFilter.shouldSkip('merge_request', 'merge_request.review.individual') || !this.matchesLabelFilter(event)) {
            return;
        }

        log.info(`onMergeRequestReviewed ${this.roomId} ${this.instance}/${this.path} !${event.object_attributes.iid}`);
        this.validateMREvent(event);
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

    public async onMergeRequestCommentCreated(event: IGitLabWebhookNoteEvent) {
        if (!event.merge_request || event.object_attributes.noteable_type !== "MergeRequest") {
            // Not a MR comment
            return;
        }
        if (this.hookFilter.shouldSkip('merge_request', 'merge_request.review') || !this.matchesLabelFilter(event.merge_request)) {
            return;
        }
        log.info(`onCommentCreated ${this.roomId} ${this.toString()} !${event.merge_request?.iid} ${event.object_attributes.id}`);

        this.debounceMergeRequestReview(event.user, event.merge_request, event.project, {
            commentCount: 1,
            commentNotes: this.state.includeCommentBody ? [event.object_attributes.note] : undefined,
            discussionId: event.object_attributes.discussion_id,
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
        await this.intent.underlyingClient.sendStateEvent(this.roomId, GitLabRepoConnection.CanonicalEventType, this.stateKey, validatedConfig);
        this.state = validatedConfig;
        this.hookFilter.enabledHooks = this.state.enableHooks;
    }

    public async onRemove() {
        log.info(`Removing ${this.toString()} for ${this.roomId}`);
        await this.grantChecker.ungrantConnection(this.roomId, { instance: this.state.instance, path: this.path });
        // Do a sanity check that the event exists.
        try {
            await this.intent.underlyingClient.getRoomStateEvent(this.roomId, GitLabRepoConnection.CanonicalEventType, this.stateKey);
            await this.intent.underlyingClient.sendStateEvent(this.roomId, GitLabRepoConnection.CanonicalEventType, this.stateKey, { disabled: true });
        } catch (ex) {
            await this.intent.underlyingClient.getRoomStateEvent(this.roomId, GitLabRepoConnection.LegacyCanonicalEventType, this.stateKey);
            await this.intent.underlyingClient.sendStateEvent(this.roomId, GitLabRepoConnection.LegacyCanonicalEventType, this.stateKey, { disabled: true });
        }
        // TODO: Clean up webhooks
    }

    private setDiscussionThreads(discussionThreads: SerializedGitlabDiscussionThreads): void {
        for (const { discussionId, eventId } of discussionThreads) {
            this.discussionThreads.set(discussionId, Promise.resolve(eventId));
        }
    }

    private async persistDiscussionThreads(): Promise<void> {
        const serialized: SerializedGitlabDiscussionThreads = [];
        for (const [discussionId, eventIdPromise] of this.discussionThreads.entriesAscending()) {
            const eventId = await eventIdPromise.catch(() => { /* logged elsewhere */ });
            if (eventId) {
                serialized.push({ discussionId, eventId });
            }

        }
        return this.storage.setGitlabDiscussionThreads(this.connectionId, serialized);
    }
}

// Typescript doesn't understand Prototypes very well yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const res = compileBotCommands(GitLabRepoConnection.prototype as any, CommandConnection.prototype as any);
GitLabRepoConnection.helpMessage = res.helpMessage;
GitLabRepoConnection.botCommands = res.botCommands;
