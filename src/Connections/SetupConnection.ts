// We need to instantiate some functions which are not directly called, which confuses typescript.
import { Appservice } from "matrix-bot-sdk";
import { BotCommands, botCommand, compileBotCommands, HelpFunction } from "../BotCommands";
import { CommandConnection } from "./CommandConnection";
import { GenericHookConnection, GitHubRepoConnection, JiraProjectConnection } from ".";
import { CommandError } from "../errors";
import { UserTokenStore } from "../UserTokenStore";
import { GithubInstance } from "../Github/GithubInstance";
import { v4 as uuid } from "uuid";
import { BridgeConfig, BridgePermissionLevel } from "../Config/Config";
import markdown from "markdown-it";
import { FigmaFileConnection } from "./FigmaFileConnection";
import { URL } from "url";
import { SetupWidget } from "../Widgets/SetupWidget";
import { AdminRoom } from "../AdminRoom";
const md = new markdown();

/**
 * Handles setting up a room with connections. This connection is "virtual" in that it has
 * no state, and is only invoked when messages from other clients fall through.
 */
export class SetupConnection extends CommandConnection {
    
    static botCommands: BotCommands;
    static helpMessage: HelpFunction;

    constructor(public readonly roomId: string,
        private readonly as: Appservice,
        private readonly tokenStore: UserTokenStore,
        private readonly config: BridgeConfig,
        private readonly getOrCreateAdminRoom: (userId: string) => Promise<AdminRoom>,
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
            this.enabledHelpCategories = [
                this.config.github ? "github" : "",
                this.config.gitlab ? "gitlab": "",
                this.config.figma ? "figma": "",
                this.config.jira ? "jira": "",
                this.config.generic?.enabled ? "webhook": "",
                this.config.widgets?.roomSetupWidget ? "widget" : "",
            ];
            this.includeTitlesInHelp = false;
    }

    @botCommand("github repo", { help: "Create a connection for a GitHub repository. (You must be logged in with GitHub to do this.)", requiredArgs: ["url"], includeUserId: true, category: "github"})
    public async onGitHubRepo(userId: string, url: string) {
        if (!this.githubInstance || !this.config.github) {
            throw new CommandError("not-configured", "The bridge is not configured to support GitHub.");
        }
        if (!this.config.checkPermission(userId, "github", BridgePermissionLevel.manageConnections)) {
            throw new CommandError('You are not permitted to provision connections for GitHub.');
        }
        if (!await this.as.botClient.userHasPowerLevelFor(userId, this.roomId, "", true)) {
            throw new CommandError("not-configured", "You must be able to set state in a room ('Change settings') in order to set up new integrations.");
        }
        if (!await this.as.botClient.userHasPowerLevelFor(this.as.botUserId, this.roomId, GitHubRepoConnection.CanonicalEventType, true)) {
            throw new CommandError("Bot lacks power level to set room state", "I do not have permission to set up a bridge in this room. Please promote me to an Admin/Moderator.");
        }
        const octokit = await this.tokenStore.getOctokitForUser(userId);
        if (!octokit) {
            throw new CommandError("User not logged in", "You are not logged into GitHub. Start a DM with this bot and use the command `github login`.");
        }
        const urlParts = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(url.trim().toLowerCase());
        if (!urlParts) {
            throw new CommandError("Invalid GitHub url", "The GitHub url you entered was not valid.");
        }
        const [, org, repo] = urlParts;
        const res = await GitHubRepoConnection.provisionConnection(this.roomId, userId, {org, repo}, this.as, this.tokenStore, this.githubInstance, this.config.github);
        await this.as.botClient.sendStateEvent(this.roomId, GitHubRepoConnection.CanonicalEventType, url, res.stateEventContent);
        await this.as.botClient.sendNotice(this.roomId, `Room configured to bridge ${org}/${repo}`);
    }

    @botCommand("jira project", { help: "Create a connection for a JIRA project. (You must be logged in with JIRA to do this.)", requiredArgs: ["url"], includeUserId: true, category: "jira"})
    public async onJiraProject(userId: string, urlStr: string) {
        const url = new URL(urlStr);
        if (!this.config.jira) {
            throw new CommandError("not-configured", "The bridge is not configured to support Jira.");
        }
        if (!this.config.checkPermission(userId, "jira", BridgePermissionLevel.manageConnections)) {
            throw new CommandError('You are not permitted to provision connections for Jira.');
        }
        if (!await this.as.botClient.userHasPowerLevelFor(userId, this.roomId, "", true)) {
            throw new CommandError("not-configured", "You must be able to set state in a room ('Change settings') in order to set up new integrations.");
        }
        if (!await this.as.botClient.userHasPowerLevelFor(this.as.botUserId, this.roomId, GitHubRepoConnection.CanonicalEventType, true)) {
            throw new CommandError("Bot lacks power level to set room state", "I do not have permission to set up a bridge in this room. Please promote me to an Admin/Moderator.");
        }
        const jiraClient = await this.tokenStore.getJiraForUser(userId, urlStr);
        if (!jiraClient) {
            throw new CommandError("User not logged in", "You are not logged into Jira. Start a DM with this bot and use the command `jira login`.");
        }
        const urlParts = /.+\/projects\/(\w+)\/?(\w+\/?)*$/.exec(url.pathname.toLowerCase());
        const projectKey = urlParts?.[1] || url.searchParams.get('projectKey');
        if (!projectKey) {
            throw new CommandError("Invalid Jira url", "The JIRA project url you entered was not valid. It should be in the format of `https://jira-instance/.../projects/PROJECTKEY/...` or `.../RapidBoard.jspa?projectKey=TEST`.");
        }
        const safeUrl = `https://${url.host}/projects/${projectKey}`;
        const res = await JiraProjectConnection.provisionConnection(this.roomId, userId, { url: safeUrl }, this.as, this.tokenStore);
        await this.as.botClient.sendStateEvent(this.roomId, JiraProjectConnection.CanonicalEventType, safeUrl, res.stateEventContent);
        await this.as.botClient.sendNotice(this.roomId, `Room configured to bridge Jira project ${res.connection.projectKey}.`);
    }

    @botCommand("webhook", { help: "Create an inbound webhook.", requiredArgs: ["name"], includeUserId: true, category: "webhook"})
    public async onWebhook(userId: string, name: string) {
        if (!this.config.generic?.enabled) {
            throw new CommandError("not-configured", "The bridge is not configured to support webhooks.");
        }
        if (!this.config.checkPermission(userId, "webhooks", BridgePermissionLevel.manageConnections)) {
            throw new CommandError('You are not permitted to provision connections for generic webhooks.');
        }
        if (!await this.as.botClient.userHasPowerLevelFor(userId, this.roomId, "", true)) {
            throw new CommandError("not-configured", "You must be able to set state in a room ('Change settings') in order to set up new integrations.");
        }
        if (!await this.as.botClient.userHasPowerLevelFor(this.as.botUserId, this.roomId, GitHubRepoConnection.CanonicalEventType, true)) {
            throw new CommandError("Bot lacks power level to set room state", "I do not have permission to set up a bridge in this room. Please promote me to an Admin/Moderator.");
        }
        if (!name || name.length < 3 || name.length > 64) {
            throw new CommandError("Bad webhook name", "A webhook name must be between 3-64 characters.");
        }
        const hookId = uuid();
        const url = `${this.config.generic.urlPrefix}${this.config.generic.urlPrefix.endsWith('/') ? '' : '/'}${hookId}`;
        await GenericHookConnection.ensureRoomAccountData(this.roomId, this.as, hookId, name);
        await this.as.botClient.sendStateEvent(this.roomId, GenericHookConnection.CanonicalEventType, name, {hookId, name});
        const adminRoom = await this.getOrCreateAdminRoom(userId);
        await adminRoom.sendNotice(md.renderInline(`You have bridged a webhook. Please configure your webhook source to use \`${url}\`.`));
        return this.as.botClient.sendNotice(this.roomId, `Room configured to bridge webhooks. See admin room for secret url.`);
    }

    @botCommand("figma file", { help: "Bridge a Figma file to the room.", requiredArgs: ["url"], includeUserId: true, category: "figma"})
    public async onFigma(userId: string, url: string) {
        if (!this.config.figma) {
            throw new CommandError("not-configured", "The bridge is not configured to support Figma.");
        }
        if (!this.config.checkPermission(userId, "figma", BridgePermissionLevel.manageConnections)) {
            throw new CommandError('You are not permitted to provision connections for Figma.');
        }
        if (!await this.as.botClient.userHasPowerLevelFor(userId, this.roomId, "", true)) {
            throw new CommandError("not-configured", "You must be able to set state in a room ('Change settings') in order to set up new integrations.");
        }
        if (!await this.as.botClient.userHasPowerLevelFor(this.as.botUserId, this.roomId, GitHubRepoConnection.CanonicalEventType, true)) {
            throw new CommandError("Bot lacks power level to set room state", "I do not have permission to set up a bridge in this room. Please promote me to an Admin/Moderator.");
        }
        const res = /https:\/\/www\.figma\.com\/file\/(\w+).+/.exec(url);
        if (!res) {
            throw new CommandError("Invalid Figma url", "The Figma file url you entered was not valid. It should be in the format of `https://figma.com/file/FILEID/...`.");
        }
        const [, fileId] = res;
        await this.as.botClient.sendStateEvent(this.roomId, FigmaFileConnection.CanonicalEventType, fileId, {fileId});
        return this.as.botClient.sendHtmlNotice(this.roomId, md.renderInline(`Room configured to bridge Figma file.`));
    }

    @botCommand("setup-widget", {category: "widget", help: "Open the setup widget in the room"})
    public async onSetupWidget() {
        if (!this.config.widgets?.roomSetupWidget) {
            throw new CommandError("Not configured", "The bridge is not configured to support setup widgets");
        }
        if (!await SetupWidget.SetupRoomConfigWidget(this.roomId, this.as.botIntent, this.config.widgets)) {
            await this.as.botClient.sendNotice(this.roomId, `This room already has a setup widget, please open the "Hookshot Configuration" widget.`);
        }
    }
}

// Typescript doesn't understand Prototypes very well yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const res = compileBotCommands(SetupConnection.prototype as any, CommandConnection.prototype as any);
SetupConnection.helpMessage = res.helpMessage;
SetupConnection.botCommands = res.botCommands;
