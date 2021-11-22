/* eslint-disable @typescript-eslint/ban-ts-comment */
import { Appservice } from "matrix-bot-sdk";
import { BotCommands, handleCommand, botCommand, compileBotCommands } from "../BotCommands";
import { CommentProcessor } from "../CommentProcessor";
import { FormatUtil } from "../FormatUtil";
import { IConnection } from "./IConnection";
import { IssuesOpenedEvent, IssuesReopenedEvent, IssuesEditedEvent, PullRequestOpenedEvent, IssuesClosedEvent, PullRequestClosedEvent, PullRequestReadyForReviewEvent, PullRequestReviewSubmittedEvent, ReleaseCreatedEvent } from "@octokit/webhooks-types";
import { MatrixMessageContent, MatrixEvent, MatrixReactionContent } from "../MatrixEvent";
import { MessageSenderClient } from "../MatrixSender";
import { NotLoggedInError } from "../errors";
import { Octokit } from "@octokit/rest";
import { ReposGetResponseData } from "../Github/Types";
import { UserTokenStore } from "../UserTokenStore";
import axios from "axios";
import emoji from "node-emoji";
import LogWrapper from "../LogWrapper";
import markdown from "markdown-it";
const log = new LogWrapper("GitHubRepoConnection");
const md = new markdown();

interface IQueryRoomOpts {
    as: Appservice;
    tokenStore: UserTokenStore;
    commentProcessor: CommentProcessor;
    messageClient: MessageSenderClient;
    octokit: Octokit;
}

export interface GitHubRepoConnectionState {
    org: string;
    repo: string;
    ignoreHooks?: string[],
    commandPrefix?: string;
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

function compareEmojiStrings(e0: string, e1: string, e0Index = 0) {
    return e0.codePointAt(e0Index) === e1.codePointAt(0);
}

/**
 * Handles rooms connected to a github repo.
 */
export class GitHubRepoConnection implements IConnection {
    static readonly CanonicalEventType = "uk.half-shot.matrix-github.repository";

    static readonly EventTypes = [
        GitHubRepoConnection.CanonicalEventType, // Legacy event, with an awful name.
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
        try {
            repoRes = (await opts.octokit.repos.get({
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
            const profile = await opts.octokit.users.getByUsername({
                username: owner,
            });
            if (profile.data.avatar_url) {
                const res = await axios.get(profile.data.avatar_url as string, {
                    responseType: 'arraybuffer',
                });
                log.info(`uploading ${profile.data.avatar_url}`);
                // This does exist, but headers is silly and doesn't have content-type.
                // tslint:disable-next-line: no-any
                console.log(res.headers);
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

    constructor(public readonly roomId: string,
        private readonly as: Appservice,
        private readonly state: GitHubRepoConnectionState,
        private readonly tokenStore: UserTokenStore,
        private readonly stateKey: string) {

    }

    public get org() {
        return this.state.org.toLowerCase();
    }

    public get repo() {
        return this.state.repo.toLowerCase();
    }

    private get commandPrefix() {
        return (this.state.commandPrefix || "gh") + " ";
    }

    public isInterestedInStateEvent(eventType: string, stateKey: string) {
        return GitHubRepoConnection.EventTypes.includes(eventType) && this.stateKey === stateKey;
    }

    public async onMessageEvent(ev: MatrixEvent<MatrixMessageContent>) {
        const { error, handled, humanError } = await handleCommand(ev.sender, ev.content.body, GitHubRepoConnection.botCommands, this, this.commandPrefix);
        if (!handled) {
            // Not for us.
            return;
        }
        if (error) {
            await this.as.botClient.sendEvent(this.roomId, "m.reaction", {
                "m.relates_to": {
                    rel_type: "m.annotation",
                    event_id: ev.event_id,
                    key: "⛔",
                }
            });
            await this.as.botIntent.sendEvent(this.roomId,{
                msgtype: "m.notice",
                body: humanError ? `Failed to handle command: ${humanError}` : "Failed to handle command",
            });
            log.warn(`Failed to handle command:`, error);
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

    @botCommand("help", "This help text")
    public async helpCommand() {
        return this.as.botIntent.sendEvent(this.roomId, GitHubRepoConnection.helpMessage(this.commandPrefix));
    }

    @botCommand("create", "Create an issue for this repo", ["title"], ["description", "labels"], true)
    // @ts-ignore
    private async onCreateIssue(userId: string, title: string, description?: string, labels?: string) {
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
    // @ts-ignore
    private async onAssign(userId: string, number: string, ...users: string[]) {
        const octokit = await this.tokenStore.getOctokitForUser(userId);
        if (!octokit) {
            return this.as.botIntent.sendText(this.roomId, "You must login to assign an issue", "m.notice");
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
    // @ts-ignore
    private async onClose(userId: string, number: string, comment?: string) {
        const octokit = await this.tokenStore.getOctokitForUser(userId);
        if (!octokit) {
            return this.as.botIntent.sendText(this.roomId, "You must login to close an issue", "m.notice");
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
        
        const content = emoji.emojify(`${event.issue.user?.login} created new issue [${orgRepoName}#${event.issue.number}](${event.issue.html_url}): "${event.issue.title}"`);
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
            const issueContent = ev.content["uk.half-shot.matrix-github.issue"];
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const res = compileBotCommands(GitHubRepoConnection.prototype as any);
GitHubRepoConnection.helpMessage = res.helpMessage;
GitHubRepoConnection.botCommands = res.botCommands;