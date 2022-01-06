// We need to instantiate some functions which are not directly called, which confuses typescript.
import { Appservice } from "matrix-bot-sdk";
import { BotCommands, botCommand, compileBotCommands } from "../BotCommands";
import { MatrixMessageContent } from "../MatrixEvent";
import LogWrapper from "../LogWrapper";
import { CommandConnection } from "./CommandConnection";
import { GenericHookConnection, GitHubRepoConnection, GitHubRepoConnectionState, JiraProjectConnection, JiraProjectConnectionState } from ".";
import { CommandError } from "../errors";
import { UserTokenStore } from "../UserTokenStore";
import { GithubInstance } from "../Github/GithubInstance";
import { JiraProject } from "../Jira/Types";
import { v4 as uuid } from "uuid";
import { BridgeConfig, BridgeGenericWebhooksConfig } from "../Config/Config";
import markdown from "markdown-it";
import { FigmaFileConnection } from "./FigmaFileConnection";
const md = new markdown();

const log = new LogWrapper("SetupConnection");

/**
 * Handles setting up a room with connections. This connection is "virtual" in that it has
 * no state, and is only invoked when messages from other clients fall through.
 */
export class SetupConnection extends CommandConnection {
    
    static botCommands: BotCommands;
    static helpMessage: (cmdPrefix?: string | undefined) => MatrixMessageContent;

    constructor(public readonly roomId: string,
        private readonly as: Appservice,
        private readonly tokenStore: UserTokenStore,
        private readonly config: BridgeConfig,
        private readonly githubInstance?: GithubInstance,) {
            super(
                roomId,
                "",
                "",
                as.botClient,
                SetupConnection.botCommands,
                SetupConnection.helpMessage,
                "!hookshot",
            )
    }

    @botCommand("github repo", "Create a connection for a GitHub repository. (You must be logged in with GitHub to do this)", ["url"], [], true)
    public async onGitHubRepo(userId: string, url: string) {
        if (!this.githubInstance) {
            throw new CommandError("not-configured", "The bridge is not configured to support GitHub");
        }
        if (!await this.as.botClient.userHasPowerLevelFor(userId, this.roomId, "", true)) {
            throw new CommandError("not-configured", "You must be able to set state in a room ('Change settings') in order to setup new integrations.");
        }
        if (!await this.as.botClient.userHasPowerLevelFor(this.as.botUserId, this.roomId, GitHubRepoConnection.CanonicalEventType, true)) {
            throw new CommandError("Bot lacks power level to set room state", "I do not have permission to setup a bridge in this room. Please promote me to an Admin/Moderator");
        }
        const octokit = await this.tokenStore.getOctokitForUser(userId);
        if (!octokit) {
            throw new CommandError("User not logged in", "You are not logged into GitHub. Start a DM with this bot and use the command `github login`.");
        }
        const res = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(url.trim().toLowerCase());
        if (!res) {
            throw new CommandError("Invalid GitHub url", "The GitHub url you entered was not valid");
        }
        const [, org, repo] = res;
        let resultRepo
        try {
            resultRepo = await octokit.repos.get({owner: org, repo});
        } catch (ex) {
            throw new CommandError("Invalid GitHub repo", "Could not find the requested GitHub repo. Do you have permission to view it?");
        }
        // Check if we have a webhook for this repo
        try {
            await this.githubInstance.getOctokitForRepo(org, repo);
        } catch (ex) {
            log.warn(`No app instance for new git connection:`, ex);
            // We might be able to do it via a personal access token
            await this.as.botClient.sendNotice(this.roomId, `Note: There doesn't appear to be a GitHub App install that covers this repository so webhooks won't work.`)
        }
        await this.as.botClient.sendStateEvent(this.roomId, GitHubRepoConnection.CanonicalEventType, url, {
            org,
            repo,
        } as GitHubRepoConnectionState);
        await this.as.botClient.sendNotice(this.roomId, `Room configured to bridge ${resultRepo.data.full_name}`);
    }

    @botCommand("jira project", "Create a connection for a JIRA project. (You must be logged in with JIRA to do this)", ["url"], [], true)
    public async onJiraProject(userId: string, url: string) {
        if (!this.config.jira) {
            throw new CommandError("not-configured", "The bridge is not configured to support Jira");
        }
        if (!await this.as.botClient.userHasPowerLevelFor(userId, this.roomId, "", true)) {
            throw new CommandError("not-configured", "You must be able to set state in a room ('Change settings') in order to setup new integrations.");
        }
        if (!await this.as.botClient.userHasPowerLevelFor(this.as.botUserId, this.roomId, GitHubRepoConnection.CanonicalEventType, true)) {
            throw new CommandError("Bot lacks power level to set room state", "I do not have permission to setup a bridge in this room. Please promote me to an Admin/Moderator");
        }
        const jiraClient = await this.tokenStore.getJiraForUser(userId);
        if (!jiraClient) {
            throw new CommandError("User not logged in", "You are not logged into Jira. Start a DM with this bot and use the command `jira login`.");
        }
        const res = /^https:\/\/([A-z.\-_]+)\/.+\/projects\/(\w+)\/?(\w+\/?)*$/.exec(url.trim().toLowerCase());
        if (!res) {
            throw new CommandError("Invalid Jira url", "The JIRA project url you entered was not valid. It should be in the format of `https://jira-instance/.../projects/PROJECTKEY/...`");
        }
        const [, origin, projectKey] = res;
        const safeUrl = `https://${origin}/projects/${projectKey}`;
        const jiraOriginClient = await jiraClient.getClientForUrl(new URL(safeUrl));
        if (!jiraOriginClient) {
            throw new CommandError("User does not have permission to access this JIRA instance", "You do not have access to this JIRA instance. You may need to log into Jira again to provide access");
        }
        let jiraProject: JiraProject;
        try {
            jiraProject = await jiraOriginClient.getProject(projectKey.toUpperCase());
        } catch (ex) {
            log.warn(`Failed to get jira project:`, ex);
            throw new CommandError("Missing or invalid JIRA project", "Could not find the requested JIRA project. Do you have permission to view it?");
        }
        await this.as.botClient.sendStateEvent(this.roomId, JiraProjectConnection.CanonicalEventType, safeUrl, {
            url: safeUrl,
        } as JiraProjectConnectionState);
        await this.as.botClient.sendNotice(this.roomId, `Room configured to bridge Jira project '${jiraProject.name}' (${jiraProject.key})`);
    }

    @botCommand("webhook", "Create a inbound webhook", ["name"], [], true)
    public async onWebhook(userId: string, name: string) {
        if (!this.config.generic?.enabled) {
            throw new CommandError("not-configured", "The bridge is not configured to support webhooks");
        }
        if (!await this.as.botClient.userHasPowerLevelFor(userId, this.roomId, "", true)) {
            throw new CommandError("not-configured", "You must be able to set state in a room ('Change settings') in order to setup new integrations.");
        }
        if (!await this.as.botClient.userHasPowerLevelFor(this.as.botUserId, this.roomId, GitHubRepoConnection.CanonicalEventType, true)) {
            throw new CommandError("Bot lacks power level to set room state", "I do not have permission to setup a bridge in this room. Please promote me to an Admin/Moderator");
        }
        if (!name || name.length < 3 || name.length > 64) {
            throw new CommandError("Bad webhook name", "A webhook name must be between 3-64 characters");
        }
        const hookId = uuid();
        const url = `${this.config.generic.urlPrefix}${this.config.generic.urlPrefix.endsWith('/') ? '' : '/'}${hookId}`;
        await GenericHookConnection.ensureRoomAccountData(this.roomId, this.as, hookId, name);
        await this.as.botClient.sendStateEvent(this.roomId, GenericHookConnection.CanonicalEventType, name, {hookId, name});
        return this.as.botClient.sendHtmlNotice(this.roomId, md.renderInline(`Room configured to bridge webhooks. Please configure your webhook source to use \`${url}\``));
    }

    @botCommand("figma file", "Bridge a Figma file to the room", ["url"], [], true)
    public async onFigma(userId: string, url: string) {
        if (!this.config.figma) {
            throw new CommandError("not-configured", "The bridge is not configured to support Figma");
        }
        if (!await this.as.botClient.userHasPowerLevelFor(userId, this.roomId, "", true)) {
            throw new CommandError("not-configured", "You must be able to set state in a room ('Change settings') in order to setup new integrations.");
        }
        if (!await this.as.botClient.userHasPowerLevelFor(this.as.botUserId, this.roomId, GitHubRepoConnection.CanonicalEventType, true)) {
            throw new CommandError("Bot lacks power level to set room state", "I do not have permission to setup a bridge in this room. Please promote me to an Admin/Moderator");
        }
        const res = /https:\/\/www\.figma\.com\/file\/(\w+).+/.exec(url);
        if (!res) {
            throw new CommandError("Invalid Figma url", "The Figma file url you entered was not valid. It should be in the format of `https://figma.com/file/FILEID/...`");
        }
        const [, fileId] = res;
        await this.as.botClient.sendStateEvent(this.roomId, FigmaFileConnection.CanonicalEventType, fileId, {fileId});
        return this.as.botClient.sendHtmlNotice(this.roomId, md.renderInline(`Room configured to bridge Figma file.`));
    }
}

// Typescript doesn't understand Prototypes very well yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const res = compileBotCommands(SetupConnection.prototype as any, CommandConnection.prototype as any);
SetupConnection.helpMessage = res.helpMessage;
SetupConnection.botCommands = res.botCommands;
