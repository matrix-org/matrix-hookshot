/* eslint-disable @typescript-eslint/ban-ts-comment */
import { Appservice } from "matrix-bot-sdk";
import { BotCommands, botCommand, compileBotCommands } from "../BotCommands";
import { CommentProcessor } from "../CommentProcessor";
import { FormatUtil } from "../FormatUtil";
import { IConnection } from "./IConnection";
import { IssuesOpenedEvent, IssuesReopenedEvent, IssuesEditedEvent, PullRequestOpenedEvent, IssuesClosedEvent, PullRequestClosedEvent, PullRequestReadyForReviewEvent, PullRequestReviewSubmittedEvent, ReleaseCreatedEvent } from "@octokit/webhooks-types";
import { MatrixMessageContent, MatrixEvent, MatrixReactionContent } from "../MatrixEvent";
import { MessageSenderClient } from "../MatrixSender";
import { CommandError, NotLoggedInError } from "../errors";
import { ReposGetResponseData } from "../Github/Types";
import { UserTokenStore } from "../UserTokenStore";
import axios, { AxiosError } from "axios";
import emoji from "node-emoji";
import LogWrapper from "../LogWrapper";
import markdown from "markdown-it";
import { CommandConnection } from "./CommandConnection";
import { GithubInstance } from "../Github/GithubInstance";
import { GitHubIssueConnection } from ".";
import { BridgeConfigGitHub } from "../Config/Config";
import { ApiError, ErrCode } from "../provisioning/api";
const log = new LogWrapper("GitHubRepoConnection");
const md = new markdown();

interface IQueryRoomOpts {
    as: Appservice;
    tokenStore: UserTokenStore;
    commentProcessor: CommentProcessor;
    messageClient: MessageSenderClient;
    githubInstance: GithubInstance;
}

export interface GitHubRepoConnectionState {
    org: string;
    repo: string;
    ignoreHooks?: AllowedEventsNames[],
    commandPrefix?: string;
    showIssueRoomLink?: boolean;
}

const GITHUB_REACTION_CONTENT: {[emoji: string]: string} = {
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


type AllowedEventsNames = 
    "issue.changed" |
    "issue.created" |
    "issue.edited" |
    "issue" | 
    "pull_request.closed" |
    "pull_request.merged" |
    "pull_request.opened" |
    "pull_request.ready_for_review" |
    "pull_request.reviewed" |
    "pull_request" |
    "release.created" |
    "release";

const AllowedEvents: AllowedEventsNames[] = [
    "issue.changed" ,
    "issue.created" ,
    "issue.edited" ,
    "issue" ,
    "pull_request.closed" ,
    "pull_request.merged" ,
    "pull_request.opened" ,
    "pull_request.ready_for_review" ,
    "pull_request.reviewed" ,
    "pull_request" ,
    "release.created" ,
    "release",
];

function compareEmojiStrings(e0: string, e1: string, e0Index = 0) {
    return e0.codePointAt(e0Index) === e1.codePointAt(0);
}

function validateState(state: Record<string, unknown>): GitHubRepoConnectionState {
    if (typeof state.org !== "string") {
        throw new ApiError("Expected a 'org' property", ErrCode.BadValue);
    }
    if (typeof state.repo !== "string") {
        throw new ApiError("Expected a 'org' property", ErrCode.BadValue);
    }
    const res: GitHubRepoConnectionState = {
        org: state.org,
        repo: state.repo,
    }
    if (state.commandPrefix) {
        if (typeof state.commandPrefix !== "string") {
            throw new ApiError("Expected 'commandPrefix' to be a string", ErrCode.BadValue);
        }
        if (state.commandPrefix.length < 2 || state.commandPrefix.length > 24) {
            throw new ApiError("Expected 'commandPrefix' to be between 2-24 characters", ErrCode.BadValue);
        }
        res.commandPrefix = state.commandPrefix;
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
export class GitHubRepoConnection extends CommandConnection implements IConnection {
    static async provisionConnection(roomId: string, userId: string, data: Record<string, unknown>, as: Appservice,
        tokenStore: UserTokenStore, githubInstance: GithubInstance, config: BridgeConfigGitHub): Promise<string> {
        const validData = validateState(data);
        const octokit = await tokenStore.getOctokitForUser(userId);
        if (!octokit) {
            throw new ApiError("User is not authenticated with JIRA", ErrCode.ForbiddenUser);
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
        const appOctokit = await githubInstance.getSafeOctokitForRepo(validData.org, validData.repo);
        if (!appOctokit) {
            throw new ApiError(
                "You need to add a GitHub App to this organisation / repository before you can bridge it. Open the link to add the app, and then retry this request",
                ErrCode.AdditionalActionRequired,
                -1,
                {
                    // E.g. https://github.com/apps/matrix-bridge/installations/new
                    installUrl: `https://github.com/apps/${githubInstance.appName}/installations/new`,
                }
            );
        }
        const stateKey = `${validData.org}/${validData.repo}`;
        const eventId = await as.botIntent.underlyingClient.sendStateEvent(roomId, GitHubRepoConnection.CanonicalEventType, stateKey, data);
        log.info(`Created connection via provisionConnection for ${roomId} (${eventId})`);
        return eventId;
    }

    static readonly CanonicalEventType = "uk.half-shot.matrix-hookshot.github.repository";
    static readonly LegacyCanonicalEventType = "uk.half-shot.matrix-github.repository";

    static readonly EventTypes = [
        GitHubRepoConnection.CanonicalEventType,
        GitHubRepoConnection.LegacyCanonicalEventType,
    ];

    static readonly QueryRoomRegex = /#github_(.+)_(.+):.*/;

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
        } catch (ex) {
            log.error("Failed to get repo:", ex);
            throw Error("Could not find repo");
        }

        // URL hack so we don't need to fetch the repo itself.
        const orgRepoName = repoRes.url.substr("https://api.github.com/repos/".length);
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

    static helpMessage: (cmdPrefix: string) => MatrixMessageContent;
    static botCommands: BotCommands;

    constructor(roomId: string,
        private readonly as: Appservice,
        private state: GitHubRepoConnectionState,
        private readonly tokenStore: UserTokenStore,
        stateKey: string,
        private readonly githubInstance: GithubInstance,
        private readonly config: BridgeConfigGitHub,
        ) {
            super(
                roomId,
                stateKey,
                GitHubRepoConnection.CanonicalEventType,
                as.botClient,
                GitHubRepoConnection.botCommands,
                GitHubRepoConnection.helpMessage,
                state.commandPrefix || "!gh"
            );
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

    public async onStateUpdate(stateEv: MatrixEvent<unknown>) {
        const state = stateEv.content as GitHubRepoConnectionState;
        this.state = state;
    }

    public isInterestedInStateEvent(eventType: string, stateKey: string) {
        return GitHubRepoConnection.EventTypes.includes(eventType) && this.stateKey === stateKey;
    }

    @botCommand("create", "Create an issue for this repo", ["title"], ["description", "labels"], true)
    public async onCreateIssue(userId: string, title: string, description?: string, labels?: string) {
        const octokit = await this.tokenStore.getOctokitForUser(userId);
        if (!octokit) {
            throw new NotLoggedInError();
        }
        const labelsNames = labels?.split(",");
        const res = await octokit.issues.create({
            repo: this.state.repo,
            owner: this.state.org,
            title: title,
            body: description,
            labels: labelsNames,
        });

        const content = `Created issue #${res.data.number}: [${res.data.html_url}](${res.data.html_url})`;
        return this.as.botIntent.sendEvent(this.roomId,{
            msgtype: "m.notice",
            body: content,
            formatted_body: md.render(content),
            format: "org.matrix.custom.html"
        });
    }

    @botCommand("assign", "Assign an issue to a user", ["number", "...users"], [], true)
    public async onAssign(userId: string, number: string, ...users: string[]) {
        const octokit = await this.tokenStore.getOctokitForUser(userId);
        if (!octokit) {
            throw new NotLoggedInError();
        }

        if (users.length === 1) {
            users = users[0].split(",");
        }

        await octokit.issues.addAssignees({
            repo: this.state.repo,
            owner: this.state.org,
            issue_number: parseInt(number, 10),
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
            await this.as.botIntent.sendText(this.roomId, `Could not find a workflow by the name of "${name}". The workflows on this repository are ${workflowNames}`, "m.notice");
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

        await this.as.botIntent.sendText(this.roomId, `Workflow started`, "m.notice");
    }

    public async onIssueCreated(event: IssuesOpenedEvent) {
        if (this.shouldSkipHook('issue.created', 'issue')) {
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

        let message = `${event.issue.user?.login} created new issue [${orgRepoName}#${event.issue.number}](${event.issue.html_url}): "${event.issue.title}"`;
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
            // TODO: Fix types.
            ...FormatUtil.getPartialBodyForIssue(event.repository, event.issue as any),
        });
    }

    public async onIssueStateChange(event: IssuesEditedEvent|IssuesReopenedEvent|IssuesClosedEvent) {
        if (this.shouldSkipHook('issue.changed', 'issue')) {
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
        const content = `**${event.sender.login}** ${state} issue [${orgRepoName}#${event.issue.number}](${event.issue.html_url}): "${emoji.emojify(event.issue.title)}"`;
        await this.as.botIntent.sendEvent(this.roomId, {
            msgtype: "m.notice",
            body: content,
            formatted_body: md.renderInline(content),
            format: "org.matrix.custom.html",
            // TODO: Fix types
            ...FormatUtil.getPartialBodyForIssue(event.repository, event.issue as any),
        });
    }

    public async onIssueEdited(event: IssuesEditedEvent) {
        if (this.shouldSkipHook('issue.edited', 'issue')) {
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
            // TODO: Fix types
            ...FormatUtil.getPartialBodyForIssue(event.repository, event.issue as any),
        });
    }

    public async onPROpened(event: PullRequestOpenedEvent) {
        if (this.shouldSkipHook('pull_request.opened', 'pull_request')) {
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
        const content = emoji.emojify(`**${event.sender.login}** ${verb} a new PR [${orgRepoName}#${event.pull_request.number}](${event.pull_request.html_url}): "${event.pull_request.title}"`);
        const labels = FormatUtil.formatLabels(event.pull_request.labels?.map(l => ({ name: l.name, description: l.description || undefined, color: l.color || undefined }))); 
        await this.as.botIntent.sendEvent(this.roomId, {
            msgtype: "m.notice",
            body: content + (labels.plain.length > 0 ? ` with labels ${labels}`: ""),
            formatted_body: md.renderInline(content) + (labels.html.length > 0 ? ` with labels ${labels.html}`: ""),
            format: "org.matrix.custom.html",
            // TODO: Fix types.
            ...FormatUtil.getPartialBodyForIssue(event.repository, event.pull_request as any),
        });
    }

    public async onPRReadyForReview(event: PullRequestReadyForReviewEvent) {
        if (this.shouldSkipHook('pull_request.ready_for_review', 'pull_request')) {
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
        const content = emoji.emojify(`**${event.sender.login}** has marked [${orgRepoName}#${event.pull_request.number}](${event.pull_request.html_url}) as ready to review (${event.pull_request.title})`);
        await this.as.botIntent.sendEvent(this.roomId, {
            msgtype: "m.notice",
            body: content,
            formatted_body: md.renderInline(content),
            format: "org.matrix.custom.html",
            // TODO: Fix types.
            ...FormatUtil.getPartialBodyForIssue(event.repository, event.pull_request as any),
        });
    }

    public async onPRReviewed(event: PullRequestReviewSubmittedEvent) {
        if (this.shouldSkipHook('pull_request.reviewed', 'pull_request')) {
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
        const content = emoji.emojify(`**${event.sender.login}** ${emojiForReview} ${event.review.state.toLowerCase()} [${orgRepoName}#${event.pull_request.number}](${event.pull_request.html_url}) (${event.pull_request.title})`);
        await this.as.botIntent.sendEvent(this.roomId, {
            msgtype: "m.notice",
            body: content,
            formatted_body: md.renderInline(content),
            format: "org.matrix.custom.html",
            // TODO: Fix types.
            ...FormatUtil.getPartialBodyForIssue(event.repository, event.pull_request as any),
        });
    }

    public async onPRClosed(event: PullRequestClosedEvent) {
        if (this.shouldSkipHook('pull_request.closed', 'pull_request')) {
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
        const content = emoji.emojify(`**${event.sender.login}** ${verb} PR [${orgRepoName}#${event.pull_request.number}](${event.pull_request.html_url}): "${event.pull_request.title}"`);
        await this.as.botIntent.sendEvent(this.roomId, {
            msgtype: "m.notice",
            body: content,
            formatted_body: md.renderInline(content),
            format: "org.matrix.custom.html",
            // TODO: Fix types.
            ...FormatUtil.getPartialBodyForIssue(event.repository, event.pull_request as any),
        });
    }

    public async onReleaseCreated(event: ReleaseCreatedEvent) {
        if (this.shouldSkipHook('release', 'release.created')) {
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

    public async onEvent(evt: MatrixEvent<unknown>) {
        const octokit = await this.tokenStore.getOctokitForUser(evt.sender);
        if (!octokit) {
            return;
        }
        if (evt.type === 'm.reaction') {
            // eslint-disable-next-line camelcase
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
                    content: reactionName as any,
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

    public static getProvisionerDetails(botUserId: string) {
        return {
            service: "github",
            eventType: GitHubRepoConnection.CanonicalEventType,
            type: "JiraProject",
            // TODO: Add ability to configure the bot per connnection type.
            botUserId: botUserId,
        }
    }

    public getProvisionerDetails() {
        return {
            ...GitHubRepoConnection.getProvisionerDetails(this.as.botUserId),
            id: this.connectionId,
            config: {
                ...this.state,
            },
        }
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const res = compileBotCommands(GitHubRepoConnection.prototype as any, CommandConnection.prototype as any);
GitHubRepoConnection.helpMessage = res.helpMessage;
GitHubRepoConnection.botCommands = res.botCommands;
