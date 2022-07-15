// We need to instantiate some functions which are not directly called, which confuses typescript.
import { BotCommands, botCommand, compileBotCommands, HelpFunction } from "../BotCommands";
import { CommandConnection } from "./CommandConnection";
import { GenericHookConnection, GitHubRepoConnection, JiraProjectConnection } from ".";
import { CommandError } from "../errors";
import { v4 as uuid } from "uuid";
import { BridgePermissionLevel } from "../Config/Config";
import markdown from "markdown-it";
import { FigmaFileConnection } from "./FigmaFileConnection";
import { FeedConnection, FeedConnectionState } from "./FeedConnection";
import { URL } from "url";
import { SetupWidget } from "../Widgets/SetupWidget";
import { AdminRoom } from "../AdminRoom";
import { GitLabRepoConnection } from "./GitlabRepo";
import { ProvisionConnectionOpts } from "./IConnection";
import LogWrapper from "../LogWrapper";
const md = new markdown();
const log = new LogWrapper("SetupConnection");

/**
 * Handles setting up a room with connections. This connection is "virtual" in that it has
 * no state, and is only invoked when messages from other clients fall through.
 */
export class SetupConnection extends CommandConnection {
    
    static botCommands: BotCommands;
    static helpMessage: HelpFunction;

    private get config() {
        return this.provisionOpts.config;
    }

    private get as() {
        return this.provisionOpts.as;
    }

    constructor(public readonly roomId: string,
        private readonly provisionOpts: ProvisionConnectionOpts,
        private readonly getOrCreateAdminRoom: (userId: string) => Promise<AdminRoom>,) {
            super(
                roomId,
                "",
                "",
                // TODO Consider storing room-specific config in state.
                {},
                provisionOpts.as.botClient,
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
                this.config.feeds?.enabled ? "feed" : "",
                this.config.widgets?.roomSetupWidget ? "widget" : "",
            ];
            this.includeTitlesInHelp = false;
    }

    @botCommand("github repo", { help: "Create a connection for a GitHub repository. (You must be logged in with GitHub to do this.)", requiredArgs: ["url"], includeUserId: true, category: "github"})
    public async onGitHubRepo(userId: string, url: string) {
        if (!this.provisionOpts.github || !this.config.github) {
            throw new CommandError("not-configured", "The bridge is not configured to support GitHub.");
        }

        await this.checkUserPermissions(userId, "github", GitHubRepoConnection.CanonicalEventType);
        const octokit = await this.provisionOpts.tokenStore.getOctokitForUser(userId);
        if (!octokit) {
            throw new CommandError("User not logged in", "You are not logged into GitHub. Start a DM with this bot and use the command `github login`.");
        }
        const urlParts = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(url.trim().toLowerCase());
        if (!urlParts) {
            throw new CommandError("Invalid GitHub url", "The GitHub url you entered was not valid.");
        }
        const [, org, repo] = urlParts;
        const {connection} = await GitHubRepoConnection.provisionConnection(this.roomId, userId, {org, repo}, this.provisionOpts);
        await this.as.botClient.sendNotice(this.roomId, `Room configured to bridge ${connection.org}/${connection.repo}`);
    }

    @botCommand("gitlab project", { help: "Create a connection for a GitHub project. (You must be logged in with GitLab to do this.)", requiredArgs: ["url"], includeUserId: true, category: "gitlab"})
    public async onGitLabRepo(userId: string, url: string) {
        if (!this.config.gitlab) {
            throw new CommandError("not-configured", "The bridge is not configured to support GitLab.");
        }
        url = url.toLowerCase();

        await this.checkUserPermissions(userId, "gitlab", GitLabRepoConnection.CanonicalEventType);

        const {name, instance} = this.config.gitlab.getInstanceByProjectUrl(url) || {};
        if (!instance || !name) {
            throw new CommandError("not-configured", "No instance found that matches the provided URL.");
        }

        const client = await this.provisionOpts.tokenStore.getGitLabForUser(userId, instance.url);
        if (!client) {
            throw new CommandError("User not logged in", "You are not logged into this GitLab instance. Start a DM with this bot and use the command `gitlab personaltoken`.");
        }
        const path = url.slice(instance.url.length + 1);
        if (!path) {
            throw new CommandError("Invalid GitLab url", "The GitLab project url you entered was not valid.");
        }
        const {connection} = await GitLabRepoConnection.provisionConnection(this.roomId, userId, {path, instance: name}, this.provisionOpts);
        await this.as.botClient.sendNotice(this.roomId, `Room configured to bridge ${connection.path}`);
    }

    @botCommand("jira project", { help: "Create a connection for a JIRA project. (You must be logged in with JIRA to do this.)", requiredArgs: ["url"], includeUserId: true, category: "jira"})
    public async onJiraProject(userId: string, urlStr: string) {
        const url = new URL(urlStr);
        if (!this.config.jira) {
            throw new CommandError("not-configured", "The bridge is not configured to support Jira.");
        }

        await this.checkUserPermissions(userId, "jira", JiraProjectConnection.CanonicalEventType);

        const jiraClient = await this.provisionOpts.tokenStore.getJiraForUser(userId, urlStr);
        if (!jiraClient) {
            throw new CommandError("User not logged in", "You are not logged into Jira. Start a DM with this bot and use the command `jira login`.");
        }
        const urlParts = /.+\/projects\/(\w+)\/?(\w+\/?)*$/.exec(url.pathname.toLowerCase());
        const projectKey = urlParts?.[1] || url.searchParams.get('projectKey');
        if (!projectKey) {
            throw new CommandError("Invalid Jira url", "The JIRA project url you entered was not valid. It should be in the format of `https://jira-instance/.../projects/PROJECTKEY/...` or `.../RapidBoard.jspa?projectKey=TEST`.");
        }
        const safeUrl = `https://${url.host}/projects/${projectKey}`;
        const res = await JiraProjectConnection.provisionConnection(this.roomId, userId, { url: safeUrl }, this.provisionOpts);
        await this.as.botClient.sendNotice(this.roomId, `Room configured to bridge Jira project ${res.connection.projectKey}.`);
    }

    @botCommand("webhook", { help: "Create an inbound webhook.", requiredArgs: ["name"], includeUserId: true, category: "webhook"})
    public async onWebhook(userId: string, name: string) {
        if (!this.config.generic?.enabled) {
            throw new CommandError("not-configured", "The bridge is not configured to support webhooks.");
        }

        await this.checkUserPermissions(userId, "webhooks", GitHubRepoConnection.CanonicalEventType);

        if (!name || name.length < 3 || name.length > 64) {
            throw new CommandError("Bad webhook name", "A webhook name must be between 3-64 characters.");
        }
        const c = await GenericHookConnection.provisionConnection(this.roomId, userId, {name}, this.provisionOpts);
        const url = new URL(c.connection.hookId, this.config.generic.parsedUrlPrefix);
        const adminRoom = await this.getOrCreateAdminRoom(userId);
        await adminRoom.sendNotice(`You have bridged a webhook. Please configure your webhook source to use ${url}.`);
        return this.as.botClient.sendNotice(this.roomId, `Room configured to bridge webhooks. See admin room for secret url.`);
    }

    @botCommand("figma file", { help: "Bridge a Figma file to the room.", requiredArgs: ["url"], includeUserId: true, category: "figma"})
    public async onFigma(userId: string, url: string) {
        if (!this.config.figma) {
            throw new CommandError("not-configured", "The bridge is not configured to support Figma.");
        }

        await this.checkUserPermissions(userId, "figma", FigmaFileConnection.CanonicalEventType);

        const res = /https:\/\/www\.figma\.com\/file\/(\w+).+/.exec(url);
        if (!res) {
            throw new CommandError("Invalid Figma url", "The Figma file url you entered was not valid. It should be in the format of `https://figma.com/file/FILEID/...`.");
        }
        const [, fileId] = res;
        await FigmaFileConnection.provisionConnection(this.roomId, userId, { fileId }, this.provisionOpts);
        return this.as.botClient.sendHtmlNotice(this.roomId, md.renderInline(`Room configured to bridge Figma file.`));
    }

    @botCommand("feed", { help: "Bridge an RSS/Atom feed to the room.", requiredArgs: ["url"], optionalArgs: ["label"], includeUserId: true, category: "feed"})
    public async onFeed(userId: string, url: string, label?: string) {
        if (!this.config.feeds?.enabled) {
            throw new CommandError("not-configured", "The bridge is not configured to support feeds.");
        }

        await this.checkUserPermissions(userId, "feed", FeedConnection.CanonicalEventType);

        // provisionConnection will check it again, but won't give us a nice CommandError on failure
        try {
            await FeedConnection.validateUrl(url);
        } catch (err: unknown) {
            log.debug(`Feed URL '${url}' failed validation: ${err}`);
            throw new CommandError("Invalid URL", `${url} doesn't look like a valid feed URL`);
        }

        await FeedConnection.provisionConnection(this.roomId, userId, { url, label }, this.provisionOpts);
        return this.as.botClient.sendHtmlNotice(this.roomId, md.renderInline(`Room configured to bridge \`${url}\``));
    }

    @botCommand("feed list", { help: "Show feeds currently subscribed to.", category: "feed"})
    public async onFeedList() {
        const feeds: FeedConnectionState[] = await this.as.botClient.getRoomState(this.roomId).catch((err: any) => {
            if (err.body.errcode === 'M_NOT_FOUND') {
                return []; // not an error to us
            }
            throw err;
        }).then(events =>
            events.filter(
                (ev: any) => ev.type === FeedConnection.CanonicalEventType && ev.content.url
            ).map(ev => ev.content)
        );

        if (feeds.length === 0) {
            return this.as.botClient.sendHtmlNotice(this.roomId, md.renderInline('Not subscribed to any feeds'));
        } else {
            const feedDescriptions = feeds.map(feed => {
                if (feed.label) {
                    return `[${feed.label}](${feed.url})`;
                }
                return feed.url;
            });

            return this.as.botClient.sendHtmlNotice(this.roomId, md.render(
                'Currently subscribed to these feeds:\n\n' +
                 feedDescriptions.map(desc => ` - ${desc}`).join('\n')
            ));
        }
    }

    @botCommand("feed remove", { help: "Unsubscribe from an RSS/Atom.", requiredArgs: ["url"], includeUserId: true, category: "feed"})
    public async onFeedRemove(userId: string, url: string) {
        await this.checkUserPermissions(userId, "feed", FeedConnection.CanonicalEventType);

        const event = await this.as.botClient.getRoomStateEvent(this.roomId, FeedConnection.CanonicalEventType, url).catch((err: any) => {
            if (err.body.errcode === 'M_NOT_FOUND') {
                return null; // not an error to us
            }
            throw err;
        });
        if (!event || Object.keys(event).length === 0) {
            throw new CommandError("Invalid feed URL", `Feed "${url}" is not currently bridged to this room`);
        }

        await this.as.botClient.sendStateEvent(this.roomId, FeedConnection.CanonicalEventType, url, {});
        return this.as.botClient.sendHtmlNotice(this.roomId, md.renderInline(`Unsubscribed from \`${url}\``));
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

    private async checkUserPermissions(userId: string, service: string, stateEventType: string): Promise<void> {
        if (!this.config.checkPermission(userId, service, BridgePermissionLevel.manageConnections)) {
            throw new CommandError(`You are not permitted to provision connections for ${service}.`);
        }
        if (!await this.as.botClient.userHasPowerLevelFor(userId, this.roomId, "", true)) {
            throw new CommandError("not-configured", "You must be able to set state in a room ('Change settings') in order to set up new integrations.");
        }
        if (!await this.as.botClient.userHasPowerLevelFor(this.as.botUserId, this.roomId, stateEventType, true)) {
            throw new CommandError("Bot lacks power level to set room state", "I do not have permission to set up a bridge in this room. Please promote me to an Admin/Moderator.");
        }
    }
}

// Typescript doesn't understand Prototypes very well yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const res = compileBotCommands(SetupConnection.prototype as any, CommandConnection.prototype as any);
SetupConnection.helpMessage = res.helpMessage;
SetupConnection.botCommands = res.botCommands;
