import { IConnection } from "./IConnection";
import { Appservice } from "matrix-bot-sdk";
import { MatrixMessageContent, MatrixEvent, MatrixReactionContent } from "../MatrixEvent";
import markdown from "markdown-it";
import { UserTokenStore } from "../UserTokenStore";
import LogWrapper from "../LogWrapper";
import { CommentProcessor } from "../CommentProcessor";
import { Octokit } from "@octokit/rest";
import { MessageSenderClient } from "../MatrixSender";
import { FormatUtil } from "../FormatUtil";
import axios from "axios";
import { BotCommands, handleCommand, botCommand, compileBotCommands } from "../BotCommands";
import { IGitHubWebhookEvent } from "../GithubWebhooks";

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
    state: string;
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

function compareEmojiStrings(e0: string, e1: string, e0Index: number = 0) {
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

    static async onQueryRoom(result: RegExpExecArray, opts: IQueryRoomOpts): Promise<any> {
        const parts = result!.slice(1);

        const owner = parts[0];
        const repo = parts[1];
        const issueNumber = parseInt(parts[2], 10);

        log.info(`Fetching ${owner}/${repo}/${issueNumber}`);
        let repoRes: Octokit.ReposGetResponse;
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
                const res = await axios.get(profile.data.avatar_url, {
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
    
    static helpMessage: any;
    static botCommands: BotCommands;

    constructor(public readonly roomId: string,
        private readonly as: Appservice,
        private readonly state: GitHubRepoConnectionState,
        private readonly tokenStore: UserTokenStore,
        octokit: Octokit) {

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
        const err = handleCommand(ev.sender, ev.content.body, GitHubRepoConnection.botCommands, this);
        if (err) {
            await this.as.botIntent.sendText(this.roomId, err, "m.notice");
        }
    }

    @botCommand("gh create", "Create an issue for this repo", ["title"], ["description", "labels"], true)
    public async onCreateIssue(userId: string, title: string, description?: string, labels?: string) {
        const octokit = await this.tokenStore.getOctokitForUser(userId);
        if (!octokit) {
            return this.as.botIntent.sendText(this.roomId, "You must login to create an issue", "m.notice");
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

    public async onIssueCreated(event: IGitHubWebhookEvent) {
        log.info(`onIssueCreated ${this.roomId} ${this.org}/${this.repo} #${event.issue?.number}`);
        const orgRepoName = event.issue!.repository_url.substr("https://api.github.com/repos/".length);
        const content = `New issue created [${orgRepoName}#${event.issue!.number}](${event.issue!.html_url}): "${event.issue!.title}"`;
        console.log(event.issue?.labels);
        const labelsHtml = event.issue?.labels.map((label) => 
            `<span title="${label.description}" data-mx-color="#CCCCCC" data-mx-bg-color="#${label.color}">${label.name}</span>`
        ).join(" ") || "";
        const labels = event.issue?.labels.map((label) => 
            label.name
        ).join(", ") || "";
        await this.as.botIntent.sendEvent(this.roomId, {
            msgtype: "m.notice",
            body: content + (labels.length > 0 ? ` with labels ${labels}`: ""),
            formatted_body: md.renderInline(content) + (labelsHtml.length > 0 ? ` with labels ${labelsHtml}`: ""),
            format: "org.matrix.custom.html",
            ...FormatUtil.getPartialBodyForIssue(event.repository!, event.issue!),
        });
    }

    public async onIssueStateChange(event: IGitHubWebhookEvent) {
        log.info(`onIssueStateChange ${this.roomId} ${this.org}/${this.repo} #${event.issue?.number}`);
        if (event.issue?.state === "closed") {
            const orgRepoName = event.issue!.repository_url.substr("https://api.github.com/repos/".length);
            const content = `**@${event.sender!.login}** closed issue [${orgRepoName}#${event.issue!.number}](${event.issue!.html_url}): "${event.issue!.title}"`;
            await this.as.botIntent.sendEvent(this.roomId, {
                msgtype: "m.notice",
                body: content,
                formatted_body: md.renderInline(content),
                format: "org.matrix.custom.html",
                ...FormatUtil.getPartialBodyForIssue(event.repository!, event.issue!),
            });
        }
    }

    public async onEvent(evt: MatrixEvent<unknown>) {
        const octokit = await this.tokenStore.getOctokitForUser(evt.sender);
        if (!octokit) {
            return;
        }
        if (evt.type === 'm.reaction') {
            const {event_id, key} = (evt.content as MatrixReactionContent)["m.relates_to"];
            const ev = await this.as.botClient.getEvent(this.roomId, event_id);
            const issueContent = ev.content["uk.half-shot.matrix-github.issue"];
            if (!issueContent) {
                return; // Not our event.
            }

            const [,reactionName] = Object.entries(GITHUB_REACTION_CONTENT).find(([emoji, content]) => compareEmojiStrings(emoji, key)) || [];;
            const [,action] = Object.entries(ALLOWED_REACTIONS).find(([emoji]) => compareEmojiStrings(emoji, key)) || [];
            if (reactionName) {
                log.info(`Sending reaction of ${reactionName} for ${this.org}${this.repo}#${issueContent.number}`)
                await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/reactions', {
                    owner: this.org,
                    repo: this.repo,
                    issue_number: issueContent.number,
                    content: reactionName,
                    mediaType: {
                      previews: [
                        // Needed as this is a preview
                        'squirrel-girl'
                      ]
                    }
                });
            } else if (action && action[1] === "close") {
                await octokit.issues.update({
                    state: "closed",
                    owner: this.org,
                    repo: this.repo,
                    issue_number: ev.number,
                });
            } else if (action && action[1] === "open") {
                await octokit.issues.update({
                    state: "open",
                    owner: this.org,
                    repo: this.repo,
                    issue_number: ev.number,
                });
            }
            return;
        }
    }

    public async onStateUpdate() { }

    public toString() {
        return `GitHubRepo`;
    }
}

const res = compileBotCommands(GitHubRepoConnection.prototype);
GitHubRepoConnection.helpMessage = res.helpMessage;
GitHubRepoConnection.botCommands = res.botCommands;