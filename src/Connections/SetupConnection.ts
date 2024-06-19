import { BotCommands, botCommand, compileBotCommands, HelpFunction } from "../BotCommands";
import { CommandConnection } from "./CommandConnection";
import { GenericHookConnection, GenericHookConnectionState, GitHubRepoConnection, JiraProjectConnection, JiraProjectConnectionState, OutboundHookConnection } from ".";
import { CommandError } from "../errors";
import { BridgePermissionLevel } from "../config/Config";
import markdown from "markdown-it";
import { FigmaFileConnection } from "./FigmaFileConnection";
import { FeedConnection, FeedConnectionState } from "./FeedConnection";
import { URL } from "url";
import { SetupWidget } from "../Widgets/SetupWidget";
import { AdminRoom } from "../AdminRoom";
import { GitLabRepoConnection } from "./GitlabRepo";
import { IConnection, IConnectionState, ProvisionConnectionOpts } from "./IConnection";
import { ApiError, Logger } from "matrix-appservice-bridge";
import { Intent } from "matrix-bot-sdk";
import YAML from 'yaml';
import { HoundConnection } from "./HoundConnection";
const md = new markdown();
const log = new Logger("SetupConnection");

const OUTBOUND_DOCS_LINK = "https://matrix-org.github.io/matrix-hookshot/latest/setup/webhooks.html";

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

    private get intent() {
        return this.provisionOpts.intent;
    }

    private get client() {
        return this.intent.underlyingClient;
    }

    protected validateConnectionState(content: unknown) {
        log.warn("SetupConnection has no state to be validated");
        return content as IConnectionState;
    }

    constructor(
        readonly roomId: string,
        readonly prefix: string,
        readonly serviceTypes: string[],
        readonly helpCategories: string[],
        private readonly provisionOpts: ProvisionConnectionOpts,
        private readonly getOrCreateAdminRoom: (intent: Intent, userId: string) => Promise<AdminRoom>,
        private readonly pushConnections: (...connections: IConnection[]) => void,
    ) {
        super(
            roomId,
            "",
            "",
            // TODO Consider storing room-specific config in state.
            {},
            provisionOpts.intent.underlyingClient,
            SetupConnection.botCommands,
            SetupConnection.helpMessage,
            helpCategories,
            prefix,
        );
        this.includeTitlesInHelp = false;
    }

    @botCommand("github repo", { help: "Create a connection for a GitHub repository. (You must be logged in with GitHub to do this.)", requiredArgs: ["url"], includeUserId: true, category: GitHubRepoConnection.ServiceCategory})
    public async onGitHubRepo(userId: string, url: string) {
        if (!this.provisionOpts.github || !this.config.github) {
            throw new CommandError("not-configured", "The bridge is not configured to support GitHub.");
        }

        await this.checkUserPermissions(userId, GitHubRepoConnection.ServiceCategory, GitHubRepoConnection.CanonicalEventType);
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
        this.pushConnections(connection);
        await this.client.sendNotice(this.roomId, `Room configured to bridge ${connection.org}/${connection.repo}`);
    }

    @botCommand("gitlab project", { help: "Create a connection for a GitHub project. (You must be logged in with GitLab to do this.)", requiredArgs: ["url"], includeUserId: true, category: GitLabRepoConnection.ServiceCategory})
    public async onGitLabRepo(userId: string, url: string) {
        if (!this.config.gitlab) {
            throw new CommandError("not-configured", "The bridge is not configured to support GitLab.");
        }

        await this.checkUserPermissions(userId, GitLabRepoConnection.ServiceCategory, GitLabRepoConnection.CanonicalEventType);

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
        const {connection, warning} = await GitLabRepoConnection.provisionConnection(this.roomId, userId, {path, instance: name}, this.provisionOpts);
        this.pushConnections(connection);
        await this.client.sendNotice(this.roomId, `Room configured to bridge ${connection.prettyPath}` + (warning ? `\n${warning.header}: ${warning.message}` : ""));
    }

    private async checkJiraLogin(userId: string, urlStr: string) {
        const jiraClient = await this.provisionOpts.tokenStore.getJiraForUser(userId, urlStr);
        if (!jiraClient) {
            throw new CommandError("User not logged in", "You are not logged into Jira. Start a DM with this bot and use the command `jira login`.");
        }
    }

    private async getJiraProjectSafeUrl(urlStr: string) {
        const url = new URL(urlStr);
        const urlParts = /\/projects\/(\w+)\/?(\w+\/?)*$/.exec(url.pathname);
        const projectKey = urlParts?.[1] || url.searchParams.get('projectKey');
        if (!projectKey) {
            throw new CommandError("Invalid Jira url", "The JIRA project url you entered was not valid. It should be in the format of `https://jira-instance/.../projects/PROJECTKEY/...` or `.../RapidBoard.jspa?projectKey=TEST`.");
        }
        return `https://${url.host}/projects/${projectKey}`;
    }

    @botCommand("jira project", { help: "Create a connection for a JIRA project. (You must be logged in with JIRA to do this.)", requiredArgs: ["url"], includeUserId: true, category: JiraProjectConnection.ServiceCategory})
    public async onJiraProject(userId: string, urlStr: string) {
        if (!this.config.jira) {
            throw new CommandError("not-configured", "The bridge is not configured to support Jira.");
        }

        await this.checkUserPermissions(userId, JiraProjectConnection.ServiceCategory, JiraProjectConnection.CanonicalEventType);
        await this.checkJiraLogin(userId, urlStr);
        const safeUrl = await this.getJiraProjectSafeUrl(urlStr);

        const res = await JiraProjectConnection.provisionConnection(this.roomId, userId, { url: safeUrl }, this.provisionOpts);
        this.pushConnections(res.connection);
        await this.client.sendNotice(this.roomId, `Room configured to bridge Jira project ${res.connection.projectKey}.`);
    }

    @botCommand("jira list project", { help: "Show JIRA projects currently connected to.", category: JiraProjectConnection.ServiceCategory})
    public async onJiraListProject() {
        const projects: JiraProjectConnectionState[] = await this.client.getRoomState(this.roomId).catch((err: any) => {
            if (err.body.errcode === 'M_NOT_FOUND') {
                return []; // not an error to us
            }
            throw err;
        }).then(events =>
            events.filter(
                (ev: any) => (
                    ev.type === JiraProjectConnection.CanonicalEventType ||
                    ev.type === JiraProjectConnection.LegacyCanonicalEventType
                ) && ev.content.url
            ).map(ev => ev.content)
        );

        if (projects.length === 0) {
            return this.client.sendHtmlNotice(this.roomId, md.renderInline('Not connected to any JIRA projects'));
        } else {
            return this.client.sendHtmlNotice(this.roomId, md.render(
                'Currently connected to these JIRA projects:\n\n' +
                 projects.map(project => ` - ${project.url}`).join('\n')
            ));
        }
    }

    @botCommand("jira remove project", { help: "Remove a connection for a JIRA project.", requiredArgs: ["url"], includeUserId: true, category: JiraProjectConnection.ServiceCategory})
    public async onJiraRemoveProject(userId: string, urlStr: string) {
        await this.checkUserPermissions(userId, JiraProjectConnection.ServiceCategory, JiraProjectConnection.CanonicalEventType);
        await this.checkJiraLogin(userId, urlStr);
        const safeUrl = await this.getJiraProjectSafeUrl(urlStr);

        const eventTypes = [
            JiraProjectConnection.CanonicalEventType,
            JiraProjectConnection.LegacyCanonicalEventType,
        ];
        let event = null;
        let eventType = "";
        for (eventType of eventTypes) {
            try {
                event = await this.client.getRoomStateEvent(this.roomId, eventType, safeUrl);
                break;
            } catch (err: any) {
                if (err.body.errcode !== 'M_NOT_FOUND') {
                    throw err;
                }
            }
        }
        if (!event || Object.keys(event).length === 0) {
            throw new CommandError("Invalid Jira project URL", `Feed "${urlStr}" is not currently bridged to this room`);
        }

        await this.client.sendStateEvent(this.roomId, eventType, safeUrl, {});
        return this.client.sendHtmlNotice(this.roomId, md.renderInline(`Room no longer bridged to Jira project \`${safeUrl}\`.`));
    }

    @botCommand("webhook", { help: "Create an inbound webhook.", requiredArgs: ["name"], includeUserId: true, category: GenericHookConnection.ServiceCategory})
    public async onWebhook(userId: string, name: string) {
        if (!this.config.generic?.enabled) {
            throw new CommandError("not-configured", "The bridge is not configured to support webhooks.");
        }

        await this.checkUserPermissions(userId, "webhooks", GitHubRepoConnection.CanonicalEventType);

        if (!name || name.length < 3 || name.length > 64) {
            throw new CommandError("Bad webhook name", "A webhook name must be between 3-64 characters.");
        }
        const c = await GenericHookConnection.provisionConnection(this.roomId, userId, {name}, this.provisionOpts);
        this.pushConnections(c.connection);
        const url = new URL(c.connection.hookId, this.config.generic.parsedUrlPrefix);
        const adminRoom = await this.getOrCreateAdminRoom(this.intent, userId);
        const safeRoomId = encodeURIComponent(this.roomId);
        await adminRoom.sendNotice(
            `You have bridged the webhook "${name}" in https://matrix.to/#/${safeRoomId} .\n` +
            // Line break before and no full stop after URL is intentional.
            // This makes copying and pasting the URL much easier.
            `Please configure your webhook source to use\n${url}`
        );
        return this.client.sendNotice(this.roomId, `Room configured to bridge webhooks. See admin room for secret url.`);
    }



    @botCommand("webhook list", { help: "Show webhooks currently configured.", category: GenericHookConnection.ServiceCategory})
    public async onWebhookList() {
        const webhooks: GenericHookConnectionState[] = await this.client.getRoomState(this.roomId).catch((err: any) => {
            if (err.body.errcode === 'M_NOT_FOUND') {
                return []; // not an error to us
            }
            throw err;
        }).then(events =>
            events.filter(
                (ev: any) => ev.type === GenericHookConnection.CanonicalEventType && ev.content.name
            ).map(ev => ev.content)
        );

        if (webhooks.length === 0) {
            return this.client.sendHtmlNotice(this.roomId, md.renderInline('No webhooks configured'));
        } else {
            const feedDescriptions = webhooks.sort(
                (a, b) => a.name.localeCompare(b.name)
            ).map(feed => {
                return feed.name;
            });

            return this.client.sendHtmlNotice(this.roomId, md.render(
                'Webhooks configured:\n\n' +
                 feedDescriptions.map(desc => ` - ${desc}`).join('\n')
            ));
        }
    }

    @botCommand("webhook remove", { help: "Remove a webhook from the room.", requiredArgs: ["name"], includeUserId: true, category: GenericHookConnection.ServiceCategory})
    public async onWebhookRemove(userId: string, name: string) {
        await this.checkUserPermissions(userId, GenericHookConnection.ServiceCategory, GenericHookConnection.CanonicalEventType);

        const event = await this.client.getRoomStateEvent(this.roomId, GenericHookConnection.CanonicalEventType, name).catch((err: any) => {
            if (err.body.errcode === 'M_NOT_FOUND') {
                return null; // not an error to us
            }
            throw err;
        });
        if (!event || event.disabled === true || Object.keys(event).length === 0) {
            throw new CommandError("Invalid webhook name", `No webhook by the name of "${name}" is configured.`);
        }

        await this.client.sendStateEvent(this.roomId, GenericHookConnection.CanonicalEventType, name, {
            disabled: true
        });

        return this.client.sendHtmlNotice(this.roomId, md.renderInline(`Removed webhook \`${name}\``));
    }



    @botCommand("outbound-hook", { help: "Create an outbound webhook.", requiredArgs: ["name", "url"], includeUserId: true, category: GenericHookConnection.ServiceCategory})
    public async onOutboundHook(userId: string, name: string, url: string) {
        if (!this.config.generic?.outbound) {
            throw new CommandError("not-configured", "The bridge is not configured to support webhooks.");
        }

        await this.checkUserPermissions(userId, "webhooks", GitHubRepoConnection.CanonicalEventType);

        const { connection }= await OutboundHookConnection.provisionConnection(this.roomId, userId, {name, url}, this.provisionOpts);
        this.pushConnections(connection);

        const adminRoom = await this.getOrCreateAdminRoom(this.intent, userId);
        const safeRoomId = encodeURIComponent(this.roomId);

        await this.client.sendHtmlNotice(
            adminRoom.roomId,
            md.renderInline(
            `You have bridged the webhook "${name}" in https://matrix.to/#/${safeRoomId} .\n` +
            // Line break before and no full stop after URL is intentional.
            // This makes copying and pasting the URL much easier.
            `Please use the secret token \`${connection.outboundToken}\` when validating the request.\n` +
            `See the [documentation](${OUTBOUND_DOCS_LINK}) for more information`,
        ));
        return this.client.sendNotice(this.roomId, `Room configured to bridge outbound webhooks. See admin room for the secret token.`);
    }


    @botCommand("figma file", { help: "Bridge a Figma file to the room.", requiredArgs: ["url"], includeUserId: true, category: FigmaFileConnection.ServiceCategory})
    public async onFigma(userId: string, url: string) {
        if (!this.config.figma) {
            throw new CommandError("not-configured", "The bridge is not configured to support Figma.");
        }

        await this.checkUserPermissions(userId, FigmaFileConnection.ServiceCategory, FigmaFileConnection.CanonicalEventType);

        const res = /https:\/\/www\.figma\.com\/file\/(\w+).+/.exec(url);
        if (!res) {
            throw new CommandError("Invalid Figma url", "The Figma file url you entered was not valid. It should be in the format of `https://figma.com/file/FILEID/...`.");
        }
        const [, fileId] = res;
        const {connection} = await FigmaFileConnection.provisionConnection(this.roomId, userId, { fileId }, this.provisionOpts);
        this.pushConnections(connection);
        return this.client.sendHtmlNotice(this.roomId, md.renderInline(`Room configured to bridge Figma file.`));
    }

    @botCommand("feed", { help: "Bridge an RSS/Atom feed to the room.", requiredArgs: ["url"], optionalArgs: ["label"], includeUserId: true, category: FeedConnection.ServiceCategory})
    public async onFeed(userId: string, url: string, label?: string) {
        if (!this.config.feeds?.enabled) {
            throw new CommandError("not-configured", "The bridge is not configured to support feeds.");
        }

        await this.checkUserPermissions(userId,FeedConnection.ServiceCategory, FeedConnection.CanonicalEventType);

        // provisionConnection will check it again, but won't give us a nice CommandError on failure
        try {
            await FeedConnection.validateUrl(url);
        } catch (err: unknown) {
            log.debug(`Feed URL '${url}' failed validation: ${err}`);
            if (err instanceof ApiError) {
                throw new CommandError("Invalid URL", err.error);
            } else {
                throw new CommandError("Invalid URL", `${url} doesn't look like a valid feed URL`);
            }
        }

        const {connection} = await FeedConnection.provisionConnection(this.roomId, userId, { url, label }, this.provisionOpts);
        this.pushConnections(connection);
        return this.client.sendHtmlNotice(this.roomId, md.renderInline(`Room configured to bridge \`${url}\``));
    }

    @botCommand("feed list", { help: "Show feeds currently subscribed to. Supported formats `json` and `yaml`.", optionalArgs: ["format"], category: FeedConnection.ServiceCategory})
    public async onFeedList(format?: string) {
        const useJsonFormat = format?.toLowerCase() === 'json';
        const useYamlFormat = format?.toLowerCase() === 'yaml';

        const feeds: FeedConnectionState[] = await this.client.getRoomState(this.roomId).catch((err: any) => {
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
            return this.client.sendHtmlNotice(this.roomId, md.renderInline('Not subscribed to any feeds'));
        } else {
            const feedDescriptions = feeds.sort(
                (a, b) => (a.label ?? a.url).localeCompare(b.label ?? b.url)
            ).map(feed => {
                if (useJsonFormat || useYamlFormat) {
                    return feed;
                }
                if (feed.label) {
                    return `[${feed.label}](${feed.url})`;
                }
                return feed.url;
            });

            let message = 'Currently subscribed to these feeds:\n';
            if (useJsonFormat) {
                message += `\`\`\`json\n${JSON.stringify(feedDescriptions, null, 4)}\n\`\`\``
            } else if (useYamlFormat) {
                message += `\`\`\`yaml\n${YAML.stringify(feedDescriptions)}\`\`\``
            } else {
                message += feedDescriptions.map(desc => `- ${desc}`).join('\n')
            }

            return this.client.sendHtmlNotice(this.roomId, md.render(message));
        }
    }

    @botCommand("feed remove", { help: "Unsubscribe from an RSS/Atom feed.", requiredArgs: ["url"], includeUserId: true, category: "feeds"})
    public async onFeedRemove(userId: string, url: string) {
        await this.checkUserPermissions(userId, FeedConnection.ServiceCategory, FeedConnection.CanonicalEventType);

        const event = await this.client.getRoomStateEvent(this.roomId, FeedConnection.CanonicalEventType, url).catch((err: any) => {
            if (err.body.errcode === 'M_NOT_FOUND') {
                return null; // not an error to us
            }
            throw err;
        });
        if (!event || Object.keys(event).length === 0) {
            throw new CommandError("Invalid feed URL", `Feed "${url}" is not currently bridged to this room`);
        }

        await this.client.sendStateEvent(this.roomId, FeedConnection.CanonicalEventType, url, {});
        return this.client.sendHtmlNotice(this.roomId, md.renderInline(`Unsubscribed from \`${url}\``));
    }

    @botCommand("challenghound add", { help: "Bridge a ChallengeHound challenge to the room.", requiredArgs: ["url"], includeUserId: true, category: "challengehound"})
    public async onChallengeHoundAdd(userId: string, url: string) {
        if (!this.config.challengeHound) {
            throw new CommandError("not-configured", "The bridge is not configured to support challengeHound.");
        }

        await this.checkUserPermissions(userId, HoundConnection.ServiceCategory, HoundConnection.CanonicalEventType);
        const {connection, challengeName} = await HoundConnection.provisionConnection(this.roomId, userId, { url }, this.provisionOpts);
        this.pushConnections(connection);
        return this.client.sendHtmlNotice(this.roomId, md.renderInline(`Room configured to bridge ${challengeName}. Good luck!`));
    }

    @botCommand("challenghound remove", { help: "Unbridge a ChallengeHound challenge.", requiredArgs: ["urlOrId"], includeUserId: true, category: HoundConnection.ServiceCategory})
    public async onChallengeHoundRemove(userId: string, urlOrId: string) {
        await this.checkUserPermissions(userId, HoundConnection.ServiceCategory, HoundConnection.CanonicalEventType);
        const id = urlOrId.startsWith('http') ? HoundConnection.getIdFromURL(urlOrId) : urlOrId;
        const event = await this.client.getRoomStateEvent(this.roomId, HoundConnection.CanonicalEventType, id).catch((err: any) => {
            if (err.body.errcode === 'M_NOT_FOUND') {
                return null; // not an error to us
            }
            throw err;
        });
        if (!event || Object.keys(event).length === 0) {
            throw new CommandError("Invalid feed URL", `Challenge "${id}" is not currently bridged to this room`);
        }

        await this.client.sendStateEvent(this.roomId, FeedConnection.CanonicalEventType, id, {});
        return this.client.sendHtmlNotice(this.roomId, md.renderInline(`Unsubscribed from challenge`));
    }

    @botCommand("setup-widget", {category: "widget", help: "Open the setup widget in the room"})
    public async onSetupWidget() {
        if (this.config.widgets?.roomSetupWidget === undefined) {
            throw new CommandError("Not configured", "The bridge is not configured to support setup widgets");
        }
        if (!await SetupWidget.SetupRoomConfigWidget(this.roomId, this.intent, this.config.widgets, this.serviceTypes)) {
            await this.client.sendNotice(this.roomId, `This room already has a setup widget, please open the "Hookshot Configuration" widget.`);
        }
    }

    private async checkUserPermissions(userId: string, service: string, stateEventType: string): Promise<void> {
        if (!this.config.checkPermission(userId, service, BridgePermissionLevel.manageConnections)) {
            throw new CommandError(`You are not permitted to provision connections for ${service}.`);
        }
        if (!await this.client.userHasPowerLevelFor(userId, this.roomId, "", true)) {
            throw new CommandError("not-configured", "You must be able to set state in a room ('Change settings') in order to set up new integrations.");
        }
        if (!await this.client.userHasPowerLevelFor(this.intent.userId, this.roomId, stateEventType, true)) {
            throw new CommandError("Bot lacks power level to set room state", "I do not have permission to set up a bridge in this room. Please promote me to an Admin/Moderator.");
        }
    }
}

// Typescript doesn't understand Prototypes very well yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const res = compileBotCommands(SetupConnection.prototype as any, CommandConnection.prototype as any);
SetupConnection.helpMessage = res.helpMessage;
SetupConnection.botCommands = res.botCommands;
