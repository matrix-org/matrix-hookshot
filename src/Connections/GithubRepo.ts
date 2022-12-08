/* eslint-disable @typescript-eslint/ban-ts-comment */
import { Appservice, IRichReplyMetadata, StateEvent } from "matrix-bot-sdk";
import { BotCommands, botCommand, compileBotCommands, HelpFunction } from "../BotCommands";
import { CommentProcessor } from "../CommentProcessor";
import { FormatUtil } from "../FormatUtil";
import { Connection, IConnection, IConnectionState, InstantiateConnectionOpts, ProvisionConnectionOpts } from "./IConnection";
import { GetConnectionsResponseItem } from "../provisioning/api";
import { IssuesOpenedEvent, IssuesReopenedEvent, IssuesEditedEvent, PullRequestOpenedEvent, IssuesClosedEvent, PullRequestClosedEvent,
    PullRequestReadyForReviewEvent, PullRequestReviewSubmittedEvent, ReleaseCreatedEvent, IssuesLabeledEvent, IssuesUnlabeledEvent,
    WorkflowRunCompletedEvent,
} from "@octokit/webhooks-types";
import { MatrixMessageContent, MatrixEvent, MatrixReactionContent } from "../MatrixEvent";
import { MessageSenderClient } from "../MatrixSender";
import { CommandError, NotLoggedInError } from "../errors";
import { NAMELESS_ORG_PLACEHOLDER, ReposGetResponseData } from "../Github/Types";
import { UserTokenStore } from "../UserTokenStore";
import axios, { AxiosError } from "axios";
import emoji from "node-emoji";
import { Logger } from "matrix-appservice-bridge";
import markdown from "markdown-it";
import { CommandConnection } from "./CommandConnection";
import { GithubInstance } from "../Github/GithubInstance";
import { GitHubIssueConnection } from "./GithubIssue";
import { BridgeConfigGitHub } from "../Config/Config";
import { ApiError, ErrCode, ValidatorApiError } from "../api";
import { PermissionCheckFn } from ".";
import { MinimalGitHubIssue, MinimalGitHubRepo } from "../libRs";
import Ajv, { JSONSchemaType } from "ajv";
import { HookFilter } from "../HookFilter";

const log = new Logger("GitHubRepoConnection");
const md = new markdown();

interface IQueryRoomOpts {
    as: Appservice;
    tokenStore: UserTokenStore;
    commentProcessor: CommentProcessor;
    messageClient: MessageSenderClient;
    githubInstance: GithubInstance;
}

export interface GitHubRepoConnectionOptions extends IConnectionState {
    enableHooks?: AllowedEventsNames[],
    ignoreHooks?: AllowedEventsNames[],
    showIssueRoomLink?: boolean;
    prDiff?: {
        enabled: boolean;
        maxLines: number;
    },
    includingLabels?: string[];
    excludingLabels?: string[];
    hotlinkIssues?: boolean|{
        prefix: string;
    };
    newIssue?: {
        labels: string[];
    };
    workflowRun?: {
        matchingBranch?: string;
    }
}
export interface GitHubRepoConnectionState extends GitHubRepoConnectionOptions {
    org: string;
    repo: string;
}


export interface GitHubRepoConnectionOrgTarget {
    name: string;
}
export interface GitHubRepoConnectionRepoTarget {
    state: GitHubRepoConnectionState;
    name: string;
}

export type GitHubRepoConnectionTarget = GitHubRepoConnectionOrgTarget|GitHubRepoConnectionRepoTarget;


export type GitHubRepoResponseItem = GetConnectionsResponseItem<GitHubRepoConnectionState>;


type AllowedEventsNames = 
    "issue.changed" |
    "issue.created" |
    "issue.edited" |
    "issue.labeled" |
    "issue" | 
    "pull_request.closed" |
    "pull_request.merged" |
    "pull_request.opened" |
    "pull_request.ready_for_review" |
    "pull_request.reviewed" |
    "pull_request" |
    "release.created" |
    "release" |
    "workflow" |
    "workflow.run" | 
    "workflow.run.success" |
    "workflow.run.failure" |
    "workflow.run.neutral" |
    "workflow.run.cancelled" |
    "workflow.run.timed_out" |
    "workflow.run.action_required" |
    "workflow.run.stale";

const AllowedEvents: AllowedEventsNames[] = [
    "issue.changed" ,
    "issue.created" ,
    "issue.edited" ,
    "issue.labeled" ,
    "issue" ,
    "pull_request.closed" ,
    "pull_request.merged" ,
    "pull_request.opened" ,
    "pull_request.ready_for_review" ,
    "pull_request.reviewed" ,
    "pull_request" ,
    "release.created" ,
    "release",
    "workflow",
    "workflow.run",
    "workflow.run.success",
    "workflow.run.failure",
    "workflow.run.neutral",
    "workflow.run.cancelled",
    "workflow.run.timed_out",
    "workflow.run.action_required",
    "workflow.run.stale",
];

/**
 * These hooks are enabled by default, unless they are
 * specifed in the ignoreHooks option.
 */
const AllowHookByDefault: AllowedEventsNames[] = [
    "issue",
    "pull_request",
    "release",
];

const ConnectionStateSchema = {
  type: "object",
  properties: {
    priority: {
        type: "number",
        nullable: true,
    },
    org: {type: "string"},
    repo: {type: "string"},
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
    showIssueRoomLink: { 
        type: "boolean",
        nullable: true,
    },
    prDiff: {
        type: "object",
        properties: {
            enabled: {type: "boolean"},
            maxLines: {
                type: "number",
                minimum: 1,
            },
        },
        nullable: true,
        required: ["enabled"],
    },
    newIssue: {
        type: "object",
        properties: {
            labels: {
                type: "array",
                items: {type: "string"},
            },
        },
        required: ["labels"],
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
    hotlinkIssues: {
        type: ["object","boolean"],
        nullable: true,
        oneOf: [{
            type: "object",
            required: ["prefix"],
            properties: {
                prefix: {type: "string"},
            },
        }, {
            type: "boolean",
        }],
    },
    workflowRun: {
        type: "object",
        nullable: true,
        properties: {
            matchingBranch: {
                nullable: true,
                type: "string",
            },
        },
    }
  },
  required: [
    "org",
    "repo"
  ],
  additionalProperties: true
} as JSONSchemaType<GitHubRepoConnectionState>;

type ReactionOptions = 
| "+1"
| "-1"
| "laugh"
| "confused"
| "heart"
| "hooray"
| "rocket"
| "eyes";


const GITHUB_REACTION_CONTENT: {[emoji: string]: ReactionOptions} = {
    "👍": "+1",
    "👎": "-1",
    "😄": "laugh",
    "🎉": "hooray",
    "😕": "confused",
    "❤️": "heart",
    "🚀": "rocket",
    "👀": "eyes",
}

const ALLOWED_REACTIONS = {
    "🗑️": "close",
    "🚮": "close",
    "👐": "open",
}

const EMOJI_TO_REVIEW_STATE = {
    '✅✔️☑️': 'APPROVE',
    '🔴🚫⛔️': 'REQUEST_CHANGES',
};

const WORKFLOW_CONCLUSION_TO_NOTICE: Record<WorkflowRunCompletedEvent["workflow_run"]["conclusion"], string> = {
    success: "completed sucessfully 🎉",
    failure: "failed 😟",
    neutral: "completed neutrally 😐",
    cancelled: "was cancelled 🙅",
    timed_out: "timed out ⏰",
    action_required: "requires further action 🖱️",
    stale: "completed, but is stale 🍞"
}

const LABELED_DEBOUNCE_MS = 5000;
const CREATED_GRACE_PERIOD_MS = 6000;
const DEFAULT_HOTLINK_PREFIX = "#";

function compareEmojiStrings(e0: string, e1: string, e0Index = 0) {
    return e0.codePointAt(e0Index) === e1.codePointAt(0);
}

export interface GitHubTargetFilter {
    orgName?: string;
    page?: number;
    perPage?: number;
}

/**
 * Handles rooms connected to a GitHub repo.
 */
@Connection
export class GitHubRepoConnection extends CommandConnection<GitHubRepoConnectionState> implements IConnection {

	static validateState(state: unknown, isExistingState = false): GitHubRepoConnectionState {
        const validator = new Ajv({ allowUnionTypes: true }).compile(ConnectionStateSchema);
        if (validator(state)) {
            // Validate ignoreHooks IF this is an incoming update (we can be less strict for existing state)
            if (!isExistingState && state.ignoreHooks && !state.ignoreHooks.every(h => AllowedEvents.includes(h))) {
                throw new ApiError('`ignoreHooks` must only contain allowed values', ErrCode.BadValue);
            }
            if (!isExistingState && state.enableHooks && !state.enableHooks.every(h => AllowedEvents.includes(h))) {
                throw new ApiError('`enableHooks` must only contain allowed values', ErrCode.BadValue);
            }
            return state;
        }
        throw new ValidatorApiError(validator.errors);
    }

    static async provisionConnection(roomId: string, userId: string, data: Record<string, unknown>, {as, tokenStore, github, config}: ProvisionConnectionOpts) {
        if (!github || !config.github) {
            throw Error('GitHub is not configured');
        }
        const validData = this.validateState(data);
        const octokit = await tokenStore.getOctokitForUser(userId);
        if (!octokit) {
            throw new ApiError("User is not authenticated with GitHub", ErrCode.ForbiddenUser);
        }
        const me = await octokit.users.getAuthenticated();
        let permissionLevel;
        try {
            const repo = await octokit.repos.getCollaboratorPermissionLevel({owner: validData.org, repo: validData.repo, username: me.data.login });
            permissionLevel = repo.data.permission;
        } catch (ex) {
            throw new ApiError("Could not determine if the user has access to this repository, does the repository exist?", ErrCode.ForbiddenUser);
        }

        if (permissionLevel !== "admin" && permissionLevel !== "write") {
            throw new ApiError("You must at least have write permissions to bridge this repository", ErrCode.ForbiddenUser);
        }
        const appOctokit = await github.getSafeOctokitForRepo(validData.org, validData.repo);
        if (!appOctokit) {
            throw new ApiError(
                "You need to add a GitHub App to this organisation / repository before you can bridge it. Open the link to add the app, and then retry this request",
                ErrCode.AdditionalActionRequired,
                -1,
                {
                    // E.g. https://github.com/apps/matrix-bridge/installations/new
                    installUrl: github.newInstallationUrl,
                }
            );
        }
        const stateEventKey = `${validData.org}/${validData.repo}`;
        await as.botClient.sendStateEvent(roomId, this.CanonicalEventType, stateEventKey, validData);
        return {
            stateEventContent: validData,
            connection: new GitHubRepoConnection(roomId, as, validData, tokenStore, stateEventKey, github, config.github),
        }
    }

    static readonly CanonicalEventType = "uk.half-shot.matrix-hookshot.github.repository";
    static readonly LegacyCanonicalEventType = "uk.half-shot.matrix-github.repository";
    static readonly EventTypes = [
        GitHubRepoConnection.CanonicalEventType,
        GitHubRepoConnection.LegacyCanonicalEventType,
    ];
    static readonly ServiceCategory = "github";
    static readonly QueryRoomRegex = /#github_(.+)_(.+):.*/;

    static async createConnectionForState(roomId: string, state: StateEvent<Record<string, unknown>>, {as, tokenStore, github, config}: InstantiateConnectionOpts) {
        if (!github || !config.github) {
            throw Error('GitHub is not configured');
        }
        return new GitHubRepoConnection(roomId, as, this.validateState(state.content, true), tokenStore, state.stateKey, github, config.github);
    }

    static async onQueryRoom(result: RegExpExecArray, opts: IQueryRoomOpts): Promise<unknown> {
        const parts = result?.slice(1);
        if (!parts) {
            log.error("Invalid alias pattern");
            throw Error("Could not find repo");
        }

        const owner = parts[0];
        const repo = parts[1];
        const issueNumber = parseInt(parts[2], 10);

        log.info(`Fetching ${owner}/${repo}/${issueNumber}`);
        let repoRes: ReposGetResponseData;
        const octokit = opts.githubInstance.getOctokitForRepo(owner, repo);
        try {
            repoRes = (await octokit.repos.get({
                owner,
                repo,
            })).data;
            if (repoRes.private) {
                throw Error('Refusing to bridge private repo');
            }
        } catch (ex) {
            log.error("Failed to get repo:", ex);
            throw Error("Could not find repo");
        }

        // URL hack so we don't need to fetch the repo itself.
        const orgRepoName = repoRes.full_name;
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
            name: FormatUtil.formatRepoRoomName(repoRes),
            topic: FormatUtil.formatRepoRoomTeam(repoRes),
            preset: "public_chat",
            initial_state: [
                {
                    type: this.CanonicalEventType,
                    content: {
                        org: orgRepoName.split("/")[0],
                        repo: orgRepoName.split("/")[1],
                        state: "open",
                    } as GitHubRepoConnectionState,
                    state_key: repoRes.url,
                },
                avatarUrl,
            ],
        };
    }

    static helpMessage: HelpFunction;
    static botCommands: BotCommands;

    private readonly hookFilter: HookFilter<AllowedEventsNames>;

    public debounceOnIssueLabeled = new Map<number, {labels: Set<string>, timeout: NodeJS.Timeout}>();

    constructor(roomId: string,
        private readonly as: Appservice,
        state: GitHubRepoConnectionState,
        private readonly tokenStore: UserTokenStore,
        stateKey: string,
        private readonly githubInstance: GithubInstance,
        private readonly config: BridgeConfigGitHub,
        ) {
            super(
                roomId,
                stateKey,
                GitHubRepoConnection.CanonicalEventType,
                state,
                as.botClient,
                GitHubRepoConnection.botCommands,
                GitHubRepoConnection.helpMessage,
                "!gh",
                "github",
            );
        this.hookFilter = new HookFilter(
            AllowHookByDefault,
            state.enableHooks,
            state.ignoreHooks,
        )
    }

    public get hotlinkIssues() {
        const cfg = this.config.defaultOptions?.hotlinkIssues || this.state.hotlinkIssues;
        if (cfg === false) {
            return false;
        }
        if (cfg === true || cfg === undefined || cfg.prefix === undefined) {
            return {
                prefix: DEFAULT_HOTLINK_PREFIX,
            }
        }
        return cfg;
    }

    public get org() {
        return this.state.org.toLowerCase();
    }

    private get showIssueRoomLink() {
        return this.state.showIssueRoomLink === undefined ? (this.config.defaultOptions?.showIssueRoomLink || false) : this.state.showIssueRoomLink;
    }

    public get repo() {
        return this.state.repo.toLowerCase();
    }

    public get priority(): number {
        return this.state.priority || super.priority;
    }

    protected validateConnectionState(content: unknown) {
        return GitHubRepoConnection.validateState(content);
    }

    public async onStateUpdate(stateEv: MatrixEvent<unknown>) {
        await super.onStateUpdate(stateEv);
        this.hookFilter.enabledHooks = this.state.enableHooks ?? [];
        this.hookFilter.ignoredHooks = this.state.ignoreHooks ?? [];
    }

    public isInterestedInStateEvent(eventType: string, stateKey: string) {
        return GitHubRepoConnection.EventTypes.includes(eventType) && this.stateKey === stateKey;
    }

    public async handleIssueHotlink(ev: MatrixEvent<MatrixMessageContent>): Promise<boolean> {
        if (ev.content.msgtype !== "m.text" && ev.content.msgtype !== "m.emote" || this.hotlinkIssues === false) {
            return false;
        }
        const octokit = this.githubInstance.getSafeOctokitForRepo(this.org, this.repo);
        if (!octokit) {
            // No octokit for this repo, ignoring
            return false;
        }

        let eventBody = ev.content.body.trim();
        if (!eventBody) {
            return false;
        }
        // Strip code blocks
        eventBody = eventBody.replace(/(?:```|`)[^`]+(?:```|`)/g, "");
        // Strip quotes
        eventBody = eventBody.replace(/>.+/g, "");
        const prefix = this.hotlinkIssues.prefix;

        // Simple text search
        const regex = new RegExp(`(?:^|\\s)${prefix}(\\d+)(?:$|\\s)`, "gm");
        const result = regex.exec(eventBody);
        const issueNumber = result?.[1];

        if (issueNumber) {
            let issue: MinimalGitHubIssue & { repository?: MinimalGitHubRepo, pull_request?: unknown, state: string };
            try {
                issue = (await octokit.issues.get({
                    repo: this.state.repo,
                    owner: this.state.org,
                    issue_number: parseInt(issueNumber),
                })).data;
            } catch (ex) {
                // Failed to fetch the issue, don't handle.
                return false;
            }

            let message = `${issue.pull_request ? "Pull Request" : "Issue"} [#${issue.number}](${issue.html_url}): ${issue.title} (${issue.state})`;
            if (this.showIssueRoomLink) {
                message += ` [Issue Room](https://matrix.to/#/${this.as.getAlias(GitHubIssueConnection.generateAliasLocalpart(this.org, this.repo, issue.number))})`;
            }
            const content = emoji.emojify(message);
            await this.as.botIntent.sendEvent(this.roomId, {
                msgtype: "m.notice",
                body: content ,
                formatted_body: md.renderInline(content),
                format: "org.matrix.custom.html",
                ...(issue.repository ? FormatUtil.getPartialBodyForGithubIssue(issue.repository, issue) : {}),
            });
            return true;
        }
        return false;
    }


    public async onMessageEvent(ev: MatrixEvent<MatrixMessageContent>, checkPermission: PermissionCheckFn, reply?: IRichReplyMetadata): Promise<boolean> {
        if (await super.onMessageEvent(ev, checkPermission)) {
            return true;
        }
        const body = ev.content.body?.trim();
        if (reply) {
            const repoInfo = reply.realEvent.content["uk.half-shot.matrix-hookshot.github.repo"];
            const pullRequestId = reply.realEvent.content["uk.half-shot.matrix-hookshot.github.pull_request"]?.number;
            // Emojis can be multi-byte, so make sure we split properly
            const reviewKey = Object.keys(EMOJI_TO_REVIEW_STATE).find(
                (k) => k.includes(
                    body.split(' ')[0]
                )
            );
            // Typescript is dumb.
            // @ts-ignore - property is used
            const reviewEvent = reviewKey && EMOJI_TO_REVIEW_STATE[reviewKey];
            if (body && repoInfo && pullRequestId  && reviewEvent) {
                log.info(`Handling reply to PR ${pullRequestId}`);
                const [org, owner] = repoInfo.name.split('/');
                const octokit = await this.tokenStore.getOctokitForUser(ev.sender);
                try {
                    await octokit?.pulls.createReview({
                        pull_number: pullRequestId,
                        owner: org,
                        repo: owner,
                        body: body.substr(1).trim(),
                        event: reviewEvent,
                    });
                } catch (ex) {
                    await this.as.botClient.sendEvent(this.roomId, "m.reaction", {
                        "m.relates_to": {
                            rel_type: "m.annotation",
                            event_id: ev.event_id,
                            key: "⛔",
                        }
                    });
                    await this.as.botClient.sendEvent(this.roomId, 'm.room.message', {
                        msgtype: "m.notice",
                        body: `Failed to submit review: ${ex.message}`,
                    });
                }
                return true;
            }
        }
        // We might want to do a hotlink.
        return await this.handleIssueHotlink(ev);
    }

    @botCommand("create", "Create an issue for this repo", ["title"], ["description", "labels"], true)
    public async onCreateIssue(userId: string, title: string, description?: string, labels?: string) {
        const octokit = await this.tokenStore.getOctokitForUser(userId);
        if (!octokit) {
            throw new NotLoggedInError();
        }
        const labelsNames = new Set(labels?.split(","));
        if (this.state.newIssue?.labels) {
            this.state.newIssue?.labels.forEach(l => labelsNames.add(l));
        }
        const res = await octokit.issues.create({
            repo: this.state.repo,
            owner: this.state.org,
            title: title,
            body: description,
            labels: [...labelsNames],
        });

        return {
            reaction: `Issue #${res.data.number}`,
        }
    }

    @botCommand("assign", "Assign an issue to a user. If `number` is ommitted, the latest issue is used. If `users` is omitted, you are assigned.", [], ["number", "...users"], true)
    public async onAssign(userId: string, number?: string, ...users: string[]) {
        const octokit = await this.tokenStore.getOctokitForUser(userId);
        if (!octokit) {
            throw new NotLoggedInError();
        }

        if (users.length === 1) {
            users = users[0].split(",");
        }

        if (users.length === 0) {
            // Assume self.
            users = [(await octokit.users.getAuthenticated()).data.login];
        }

        let issueNumber;
        if (number === undefined) {
            const topIssue = (await octokit.issues.listForRepo({
                owner: this.state.org,
                repo: this.state.repo,
                sort: "created",
                direction: "desc",
                per_page: 1,
            })).data[0];
            if (!topIssue) {
                throw new CommandError('No issues found', 'There are no issues on this repository');
            }
            issueNumber = topIssue.number;
        } else {
            issueNumber = parseInt(number, 10);
	}

        await octokit.issues.addAssignees({
            repo: this.state.repo,
            owner: this.state.org,
            issue_number: issueNumber,
            assignees: users,
        });
    }

    @botCommand("close", "Close an issue", ["number"], ["comment"], true)
    public async onClose(userId: string, number: string, comment?: string) {
        const octokit = await this.tokenStore.getOctokitForUser(userId);
        if (!octokit) {
            throw new NotLoggedInError();
        }

        if (comment) {
            await octokit.issues.createComment({
                repo: this.state.repo,
                owner: this.state.org,
                issue_number: parseInt(number, 10),
                body: comment,
            })
        }

        await octokit.issues.update({
            repo: this.state.repo,
            owner: this.state.org,
            issue_number: parseInt(number, 10),
            state: "closed",
        });
    }

    @botCommand("workflow run", "Run a GitHub Actions workflow. Args should be specified in \"key=value,key2='value 2'\" format.", ["name"], ["args", "ref"], true)
    public async onWorkflowRun(userId: string, name: string, args?: string, ref?: string) {
        const octokit = await this.tokenStore.getOctokitForUser(userId);
        if (!octokit) {
            throw new NotLoggedInError();
        }
        const workflowArgs: Record<string, string> = {};
        if (args) {
            args.split(',').forEach((arg) => { const [key,value] = arg.split('='); workflowArgs[key] = value || "" });
        }

        const workflows = await octokit.actions.listRepoWorkflows({
            repo: this.state.repo,
            owner: this.state.org,
        });

        const workflow = workflows.data.workflows.find(w => w.name.toLowerCase().trim() === name.toLowerCase().trim());
        if (!workflow) {
            const workflowNames = workflows.data.workflows.map(w => w.name).join(', ');
            await this.as.botIntent.sendText(this.roomId, `Could not find a workflow by the name of "${name}". The workflows on this repository are ${workflowNames}.`, "m.notice");
            return;
        }
        try {
            if (!ref) {
                ref = (await octokit.repos.get({
                    repo: this.state.repo,
                    owner: this.state.org,
                })).data.default_branch;
            }
        } catch (ex) {
            throw new CommandError(ex.message, `Could not determine default ref (maybe pass one in)`);
        }

        try {
            await octokit.actions.createWorkflowDispatch({
                repo: this.state.repo,
                owner: this.state.org,
                workflow_id: workflow.id,
                ref,
                inputs: workflowArgs,
            });
        } catch (ex) {
            const httpError = ex as AxiosError;
            if (httpError.response?.data) {
                throw new CommandError(httpError.response?.data.message, httpError.response?.data.message);
            }
            throw ex;
        }

        await this.as.botIntent.sendText(this.roomId, `Workflow started.`, "m.notice");
    }

    public async onIssueCreated(event: IssuesOpenedEvent) {
        if (this.hookFilter.shouldSkip('issue.created', 'issue') || !this.matchesLabelFilter(event.issue)) {
            return;
        }
        log.info(`onIssueCreated ${this.roomId} ${this.org}/${this.repo} #${event.issue?.number}`);
        if (!event.issue) {
            throw Error('No issue content!');
        }
        if (!event.repository) {
            throw Error('No repository content!');
        }
        const orgRepoName = event.repository.full_name;

        let message = `**${event.issue.user.login}** created new issue [${orgRepoName}#${event.issue.number}](${event.issue.html_url}): "${event.issue.title}"`;
        message += (event.issue.assignee ? ` assigned to ${event.issue.assignee.login}` : '');
        if (this.showIssueRoomLink) {
            const appInstance = await this.githubInstance.getSafeOctokitForRepo(this.org, this.repo);
            if (appInstance) {
                message += ` [Issue Room](https://matrix.to/#/${this.as.getAlias(GitHubIssueConnection.generateAliasLocalpart(this.org, this.repo, event.issue.number))})`;
            } else {
                log.warn(`Cannot show issue room link, no app install for ${orgRepoName}`);
            }
        }
        const content = emoji.emojify(message);
        const labels = FormatUtil.formatLabels(event.issue.labels?.map(l => ({ name: l.name, description: l.description || undefined, color: l.color || undefined }))); 
        await this.as.botIntent.sendEvent(this.roomId, {
            msgtype: "m.notice",
            body: content + (labels.plain.length > 0 ? ` with labels ${labels.plain}`: ""),
            formatted_body: md.renderInline(content) + (labels.html.length > 0 ? ` with labels ${labels.html}`: ""),
            format: "org.matrix.custom.html",
            ...FormatUtil.getPartialBodyForGithubIssue(event.repository, event.issue),
        });
    }

    public async onIssueStateChange(event: IssuesEditedEvent|IssuesReopenedEvent|IssuesClosedEvent) {
        if (this.hookFilter.shouldSkip('issue.changed', 'issue') || !this.matchesLabelFilter(event.issue)) {
            return;
        }
        log.info(`onIssueStateChange ${this.roomId} ${this.org}/${this.repo} #${event.issue?.number}`);
        if (!event.issue) {
            throw Error('No issue content!');
        }
        if (!event.repository) {
            throw Error('No repository content!');
        }
        const state = event.issue.state === 'open' ? 'reopened' : 'closed';
        const orgRepoName = event.repository.full_name;
        let withComment = "";
        if (state === 'reopened' || state === 'closed') {
            const octokit = this.githubInstance.getSafeOctokitForRepo(this.org, this.repo);
            if (octokit) {
                try {
                    const comments = await octokit.issues.listComments({
                        owner: this.org,
                        repo: this.repo,
                        issue_number: event.issue.number,
                        // Get comments from the 2 minutes.
                        since: new Date(Date.now() - (2 * 60000)).toISOString(),
                    });
                    const [comment] = comments.data.filter((c) => c.user?.login === event.sender.login).sort(
                        (a,b) => Date.parse(b.created_at) - Date.parse(a.created_at)
                    );
                    if (comment) {
                        withComment = ` with comment "${comment.body}"`;
                    }
                } catch (ex) {
                    log.warn(`Failed to get previous comments for closed / reopened issue.`, ex);
                }
            }
        }
        const content = `**${event.sender.login}** ${state} issue [${orgRepoName}#${event.issue.number}](${event.issue.html_url}): "${emoji.emojify(event.issue.title)}"${withComment}`;
        await this.as.botIntent.sendEvent(this.roomId, {
            msgtype: "m.notice",
            body: content,
            formatted_body: md.renderInline(content),
            format: "org.matrix.custom.html",
            ...FormatUtil.getPartialBodyForGithubIssue(event.repository, event.issue),
        });
    }

    public async onIssueEdited(event: IssuesEditedEvent) {
        if (this.hookFilter.shouldSkip('issue.edited', 'issue') || !this.matchesLabelFilter(event.issue)) {
            return;
        }
        if (!event.issue) {
            throw Error('No issue content!');
        }
        log.info(`onIssueEdited ${this.roomId} ${this.org}/${this.repo} #${event.issue.number}`);
        const orgRepoName = event.repository.full_name;
        const content = `**${event.sender.login}** edited issue [${orgRepoName}#${event.issue.number}](${event.issue.html_url}): "${emoji.emojify(event.issue.title)}"`;
        await this.as.botIntent.sendEvent(this.roomId, {
            msgtype: "m.notice",
            body: content,
            formatted_body: md.renderInline(content),
            format: "org.matrix.custom.html",
            ...FormatUtil.getPartialBodyForGithubIssue(event.repository, event.issue),
        });
    }

    public async onIssueLabeled(event: IssuesLabeledEvent) {
        if (this.hookFilter.shouldSkip('issue.labeled', 'issue') || !event.label || !this.state.includingLabels?.length) {
            return;
        }

        // We don't want to send this message if we're also sending a created message
        if (Date.now() - new Date(event.issue.created_at).getTime() < CREATED_GRACE_PERIOD_MS) {
            return;
        }
        
        log.info(`onIssueLabeled ${this.roomId} ${this.org}/${this.repo} #${event.issue.id} ${event.label.name}`);
        const renderFn = () => {
            const {labels} = this.debounceOnIssueLabeled.get(event.issue.id) || { labels: [] };
            this.debounceOnIssueLabeled.delete(event.issue.id);
            // Only render if we *explicitly* want it.
            if (![...labels.values()]?.find(l => this.state.includingLabels?.includes(l))) {
                // Not interested.
                return;
            }
            const orgRepoName = event.repository.full_name;
            const {plain, html} = FormatUtil.formatLabels(event.issue.labels?.map(l => ({ name: l.name, description: l.description || undefined, color: l.color || undefined }))); 
            const content = `**${event.sender.login}** labeled issue [${orgRepoName}#${event.issue.number}](${event.issue.html_url}): "${emoji.emojify(event.issue.title)}"`;
            this.as.botIntent.sendEvent(this.roomId, {
                msgtype: "m.notice",
                body: content + (plain.length > 0 ? ` with labels ${plain}`: ""),
                formatted_body: md.renderInline(content) + (html.length > 0 ? ` with labels ${html}`: ""),
                format: "org.matrix.custom.html",
                ...FormatUtil.getPartialBodyForGithubIssue(event.repository, event.issue),
            }).catch(ex  => {
                log.error('Failed to send onIssueLabeled message', ex);
            });

        };
        const existing = this.debounceOnIssueLabeled.get(event.issue.id);
        if (existing) {
            clearTimeout(existing.timeout);
            existing.labels.add(event.label.name);
            existing.timeout = setTimeout(renderFn, LABELED_DEBOUNCE_MS);
        } else {
            this.debounceOnIssueLabeled.set(event.issue.id, {
                labels: new Set([event.label.name]),
                timeout: setTimeout(renderFn, LABELED_DEBOUNCE_MS),
            })
        }
    }

    public onIssueUnlabeled(data: IssuesUnlabeledEvent) {
        log.info(`onIssueUnlabeled ${this.roomId} ${this.org}/${this.repo} #${data.issue.id} ${data.label?.name}`);
        const existing = this.debounceOnIssueLabeled.get(data.issue.id);
        if (existing && data.label) {
            existing.labels.delete(data.label.name);
        }
    }

    public async onPROpened(event: PullRequestOpenedEvent) {
        if (this.hookFilter.shouldSkip('pull_request.opened', 'pull_request') || !this.matchesLabelFilter(event.pull_request)) {
            return;
        }
        log.info(`onPROpened ${this.roomId} ${this.org}/${this.repo} #${event.pull_request.number}`);
        if (!event.pull_request) {
            throw Error('No pull_request content!');
        }
        if (!event.repository) {
            throw Error('No repository content!');
        }
        const orgRepoName = event.repository.full_name;
        const verb = event.pull_request.draft ? 'drafted' : 'opened';
        let diffContent = '';
        let diffContentHtml = '';
        if (this.state.prDiff?.enabled) {
            const maxDiffLen = this.state.prDiff.maxLines || 30;
            const diff = await axios.get<string>(event.pull_request.diff_url, { responseType: 'text'});
            if (diff.data.split('/n').length <= maxDiffLen) {
                // Markdown renderer wasn't handling this well, so for now hack around ourselves
                diffContent = "\n``` diff\n" + diff.data + "\n```";
                diffContentHtml = `\n<pre><code class="language-diff">${diff.data}\n</code></pre>`;
            }
        }
        const content = emoji.emojify(`**${event.sender.login}** ${verb} a new PR [${orgRepoName}#${event.pull_request.number}](${event.pull_request.html_url}): "${event.pull_request.title}"`);
        const labels = FormatUtil.formatLabels(event.pull_request.labels?.map(l => ({ name: l.name, description: l.description || undefined, color: l.color || undefined })));  
        await this.as.botIntent.sendEvent(this.roomId, {
            msgtype: "m.notice",
            body: content + (labels.plain.length > 0 ? ` with labels ${labels}`: "") + diffContent,
            formatted_body: md.renderInline(content) + (labels.html.length > 0 ? ` with labels ${labels.html}`: "") + diffContentHtml,
            format: "org.matrix.custom.html",
            ...FormatUtil.getPartialBodyForGithubIssue(event.repository, event.pull_request),
            ...FormatUtil.getPartialBodyForGitHubPR(event.repository, event.pull_request),
        });
    }

    public async onPRReadyForReview(event: PullRequestReadyForReviewEvent) {
        if (this.hookFilter.shouldSkip('pull_request.ready_for_review', 'pull_request') || !this.matchesLabelFilter(event.pull_request)) {
            return;
        }
        log.info(`onPRReadyForReview ${this.roomId} ${this.org}/${this.repo} #${event.pull_request.number}`);
        if (!event.pull_request) {
            throw Error('No pull_request content!');
        }
        if (!event.repository) {
            throw Error('No repository content!');
        }
        const orgRepoName = event.repository.full_name;
        const content = emoji.emojify(`**${event.sender.login}** has marked [${orgRepoName}#${event.pull_request.number}](${event.pull_request.html_url}) as ready to review "${event.pull_request.title}"`);
        await this.as.botIntent.sendEvent(this.roomId, {
            msgtype: "m.notice",
            body: content,
            formatted_body: md.renderInline(content),
            format: "org.matrix.custom.html",
            // TODO: Fix types.
            ...FormatUtil.getPartialBodyForGithubIssue(event.repository, event.pull_request),
        });
    }

    public async onPRReviewed(event: PullRequestReviewSubmittedEvent) {
        if (this.hookFilter.shouldSkip('pull_request.reviewed', 'pull_request') || !this.matchesLabelFilter(event.pull_request)) {
            return;
        }
        log.info(`onPRReadyForReview ${this.roomId} ${this.org}/${this.repo} #${event.pull_request.number}`);
        if (!event.pull_request) {
            throw Error('No pull_request content!');
        }
        if (!event.repository) {
            throw Error('No repository content!');
        }
        const orgRepoName = event.repository.full_name;
        const emojiForReview = {
            'approved': '✅',
        // This apparently fires each time someone comments on the PR, which is not helpful.
        //    'commented': '🗨️',
            'changes_requested': '🔴'
        }[event.review.state.toLowerCase()];
        if (!emojiForReview) {
            // We don't recongnise this state, run away!
            return;
        }
        const content = emoji.emojify(`**${event.sender.login}** ${emojiForReview} ${event.review.state.toLowerCase()} [${orgRepoName}#${event.pull_request.number}](${event.pull_request.html_url}) "${event.pull_request.title}"`);
        await this.as.botIntent.sendEvent(this.roomId, {
            msgtype: "m.notice",
            body: content,
            formatted_body: md.renderInline(content),
            format: "org.matrix.custom.html",
            // TODO: Fix types.
            ...FormatUtil.getPartialBodyForGithubIssue(event.repository, event.pull_request),
        });
    }

    public async onPRClosed(event: PullRequestClosedEvent) {
        if (this.hookFilter.shouldSkip('pull_request.closed', 'pull_request') || !this.matchesLabelFilter(event.pull_request)) {
            return;
        }
        log.info(`onPRClosed ${this.roomId} ${this.org}/${this.repo} #${event.pull_request.number}`);
        if (!event.pull_request) {
            throw Error('No pull_request content!');
        }
        if (!event.repository) {
            throw Error('No repository content!');
        }
        const orgRepoName = event.repository.full_name;
        const verb = event.pull_request.merged ? 'merged' : 'closed';
        let withComment = "";
        const octokit = this.githubInstance.getSafeOctokitForRepo(this.org, this.repo);
        if (verb == "closed" && octokit) {
            try {
                const comments = await octokit.issues.listComments({
                    owner: this.org,
                    repo: this.repo,
                    issue_number: event.pull_request.number,
                    // Get comments from the 2 minutes.
                    since: new Date(Date.now() - (2 * 60000)).toISOString(),
                });
                const [comment] = comments.data.filter((c) => c.user?.login === event.sender.login).sort(
                    (a,b) => Date.parse(b.created_at) - Date.parse(a.created_at)
                );
                if (comment) {
                    withComment = ` with comment "${comment.body}"`;
                }
            } catch (ex) {
                log.warn(`Failed to get previous comments for closed / reopened issue.`, ex);
            }
        }

        const content = emoji.emojify(`**${event.sender.login}** ${verb} PR [${orgRepoName}#${event.pull_request.number}](${event.pull_request.html_url}): "${event.pull_request.title}"${withComment}`);
        await this.as.botIntent.sendEvent(this.roomId, {
            msgtype: "m.notice",
            body: content,
            formatted_body: md.renderInline(content),
            format: "org.matrix.custom.html",
            // TODO: Fix types.
            ...FormatUtil.getPartialBodyForGithubIssue(event.repository, event.pull_request),
        });
    }

    public async onReleaseCreated(event: ReleaseCreatedEvent) {
        if (this.hookFilter.shouldSkip('release', 'release.created')) {
            return;
        }
        log.info(`onReleaseCreated ${this.roomId} ${this.org}/${this.repo} #${event.release.tag_name}`);
        if (!event.release) {
            throw Error('No release content!');
        }
        if (!event.repository) {
            throw Error('No repository content!');
        }
        const orgRepoName = event.repository.full_name;
        const content = `**${event.sender.login}** 🪄 released [${event.release.name}](${event.release.html_url}) for ${orgRepoName}

${event.release.body}`;
        await this.as.botIntent.sendEvent(this.roomId, {
            msgtype: "m.notice",
            body: content,
            formatted_body: md.render(content),
            format: "org.matrix.custom.html",
        });
    }
    
    public async onWorkflowCompleted(event: WorkflowRunCompletedEvent) {
        const workflowRun = event.workflow_run;
        const workflowRunType = `workflow.run.${workflowRun.conclusion}`;
        // Type safety checked above.
        if (
            this.hookFilter.shouldSkip('workflow', 'workflow.run', workflowRunType as AllowedEventsNames)) {
            return;
        }

        if (this.state.workflowRun?.matchingBranch && !workflowRun.head_branch.match(this.state.workflowRun?.matchingBranch)) {
            return;
        }
        log.info(`onWorkflowCompleted ${this.roomId} ${this.org}/${this.repo} '${workflowRun.id}'`);
        const orgRepoName = event.repository.full_name;
        const content = `Workflow **${event.workflow.name}** [${WORKFLOW_CONCLUSION_TO_NOTICE[workflowRun.conclusion]}](${workflowRun.html_url}) for ${orgRepoName} on branch \`${workflowRun.head_branch}\``;
        await this.as.botIntent.sendEvent(this.roomId, {
            msgtype: "m.notice",
            body: content,
            formatted_body: md.render(content),
            format: "org.matrix.custom.html",
        });
    }

    public async onEvent(evt: MatrixEvent<unknown>) {
        const octokit = await this.tokenStore.getOctokitForUser(evt.sender);
        if (!octokit) {
            return;
        }
        if (evt.type === 'm.reaction') {
            const {event_id, key} = (evt.content as MatrixReactionContent)["m.relates_to"];
            const ev = await this.as.botClient.getEvent(this.roomId, event_id);
            const issueContent = ev.content["uk.half-shot.matrix-hookshot.github.issue"];
            if (!issueContent) {
                log.debug('Reaction to event did not pertain to a issue');
                return; // Not our event.
            }

            const [,reactionName] = Object.entries(GITHUB_REACTION_CONTENT).find(([emoji]) => compareEmojiStrings(emoji, key)) || [];
            const [,action] = Object.entries(ALLOWED_REACTIONS).find(([emoji]) => compareEmojiStrings(emoji, key)) || [];
            if (reactionName) {
                log.info(`Sending reaction of ${reactionName} for ${this.org}${this.repo}#${issueContent.number}`)
                await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/reactions', {
                    owner: this.org,
                    repo: this.repo,
                    issue_number: issueContent.number,
                    content: reactionName as ReactionOptions,
                    mediaType: {
                      previews: [
                        // Needed as this is a preview
                        'squirrel-girl'
                      ]
                    }
                });
            } else if (action && action === "close") {
                await octokit.issues.update({
                    state: "closed",
                    owner: this.org,
                    repo: this.repo,
                    issue_number: issueContent.number,
                });
            } else if (action && action === "open") {
                await octokit.issues.update({
                    state: "open",
                    owner: this.org,
                    repo: this.repo,
                    issue_number: issueContent.number,
                });
            }
        }
    }

    public toString() {
        return `GitHubRepo ${this.org}/${this.repo}`;
    }

    public static getProvisionerDetails(botUserId: string) {
        return {
            service: "github",
            eventType: GitHubRepoConnection.CanonicalEventType,
            type: "GithubRepo",
            // TODO: Add ability to configure the bot per connnection type.
            botUserId: botUserId,
        }
    }

    public getProvisionerDetails(): GitHubRepoResponseItem {
        return {
            ...GitHubRepoConnection.getProvisionerDetails(this.as.botUserId),
            id: this.connectionId,
            config: {
                ...this.state,
            },
        }
    }

    public static async getConnectionTargets(userId: string, tokenStore: UserTokenStore, githubInstance: GithubInstance, filters: GitHubTargetFilter = {}): Promise<GitHubRepoConnectionTarget[]> {
        // Search for all repos under the user's control.
        const octokit = await tokenStore.getOctokitForUser(userId);
        if (!octokit) {
            throw new ApiError("User is not authenticated with GitHub", ErrCode.ForbiddenUser);
        }

        if (!filters.orgName) {
            const results: GitHubRepoConnectionOrgTarget[] = [];
            try {
                const installs = await octokit.apps.listInstallationsForAuthenticatedUser();
                for (const install of installs.data.installations) {
                    if (install.account) {
                        results.push({
                            name: install.account.login || NAMELESS_ORG_PLACEHOLDER, // org or user name
                        });
                    } else {
                        log.debug(`Skipping install ${install.id}, has no attached account`);
                    }
                }
            } catch (ex) {
                log.warn(`Failed to fetch orgs for GitHub user ${userId}`, ex);
                throw new ApiError("Could not fetch orgs for GitHub user", ErrCode.AdditionalActionRequired);
            }
            return results;
        }
        // If we have an instance, search under it.
        const ownSelf = await octokit.users.getAuthenticated();

        const page = filters.page ?? 1;
        const perPage = filters.perPage ?? 10;
        try {
            let reposPromise;

            if (ownSelf.data.login === filters.orgName) {
                const userInstallation = await githubInstance.appOctokit.apps.getUserInstallation({username: ownSelf.data.login});
                reposPromise = octokit.apps.listInstallationReposForAuthenticatedUser({
                    page,
                    installation_id: userInstallation.data.id,
                    per_page: perPage,
                });
            } else {
                const orgInstallation = await githubInstance.appOctokit.apps.getOrgInstallation({org: filters.orgName});

                // Github will error if the authed user tries to list repos of a disallowed installation, even
                // if we got the installation ID from the app's instance.
                reposPromise = octokit.apps.listInstallationReposForAuthenticatedUser({
                    page,
                    installation_id: orgInstallation.data.id,
                    per_page: perPage,
                });
            }
            const reposRes = await reposPromise;
            return reposRes.data.repositories
                .map(r => ({
                    state: {
                        org: filters.orgName,
                        repo: r.name,
                    },
                    name: r.name,
                })) as GitHubRepoConnectionRepoTarget[];
        } catch (ex) {
            log.warn(`Failed to fetch accessible repos for ${filters.orgName} / ${userId}`, ex);
            throw new ApiError("Could not fetch accessible repos for GitHub org", ErrCode.AdditionalActionRequired);
        }
    }

    public async provisionerUpdateConfig(userId: string, config: Record<string, unknown>) {
        // Apply previous state to the current config, as provisioners might not return "unknown" keys.
        const newState = { ...this.state, ...config };
        const validatedConfig = GitHubRepoConnection.validateState(newState);
        await this.as.botClient.sendStateEvent(this.roomId, GitHubRepoConnection.CanonicalEventType, this.stateKey, validatedConfig);
        this.state = validatedConfig;
        this.hookFilter.enabledHooks = this.state.enableHooks ?? [];
        this.hookFilter.ignoredHooks = this.state.ignoreHooks ?? [];
    }

    public async onRemove() {
        log.info(`Removing ${this.toString()} for ${this.roomId}`);
        // Do a sanity check that the event exists.
        try {
            await this.as.botClient.getRoomStateEvent(this.roomId, GitHubRepoConnection.CanonicalEventType, this.stateKey);
            await this.as.botClient.sendStateEvent(this.roomId, GitHubRepoConnection.CanonicalEventType, this.stateKey, { disabled: true });
        } catch (ex) {
            await this.as.botClient.getRoomStateEvent(this.roomId, GitHubRepoConnection.LegacyCanonicalEventType, this.stateKey);
            await this.as.botClient.sendStateEvent(this.roomId, GitHubRepoConnection.LegacyCanonicalEventType, this.stateKey, { disabled: true });
        }
    }

    private matchesLabelFilter(itemWithLabels: {labels?: {name: string}[]}): boolean {
        const labels = itemWithLabels.labels?.map(l => l.name) || [];
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
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const res = compileBotCommands(GitHubRepoConnection.prototype as any, CommandConnection.prototype as any);
GitHubRepoConnection.helpMessage = res.helpMessage;
GitHubRepoConnection.botCommands = res.botCommands;
