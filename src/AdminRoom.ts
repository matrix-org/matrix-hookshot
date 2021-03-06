/* eslint-disable @typescript-eslint/ban-ts-comment */
import { Intent } from "matrix-bot-sdk";
import { UserTokenStore } from "./UserTokenStore";
import { BridgeConfig } from "./Config/Config";
import {v4 as uuid} from "uuid";
import qs from "querystring";
import { EventEmitter } from "events";
import LogWrapper from "./LogWrapper";
import "reflect-metadata";
import markdown from "markdown-it";
import { FormatUtil } from "./FormatUtil";
import { botCommand, compileBotCommands, handleCommand, BotCommands } from "./BotCommands";
import { GitLabClient } from "./Gitlab/Client";
import { GetUserResponse } from "./Gitlab/Types";
import { GithubGraphQLClient, GithubInstance } from "./Github/GithubInstance";
import { MatrixMessageContent } from "./MatrixEvent";
import { ProjectsListForUserResponseData, ProjectsListForRepoResponseData } from "@octokit/types";
import { BridgeRoomState, BridgeRoomStateGitHub } from "./Widgets/BridgeWidgetInterface";


const md = new markdown();
const log = new LogWrapper('AdminRoom');

export const BRIDGE_ROOM_TYPE = "uk.half-shot.matrix-github.room";
export const BRIDGE_NOTIF_TYPE = "uk.half-shot.matrix-github.notif_state";
export const BRIDGE_GITLAB_NOTIF_TYPE = "uk.half-shot.matrix-github.gitlab.notif_state";

export interface AdminAccountData {
    // eslint-disable-next-line camelcase
    admin_user: string;
    github?: {
        notifications?: {
            enabled: boolean;
            participating?: boolean;
        };
    };
    gitlab?: {
        [instanceUrl: string]: {
            notifications: {
                enabled: boolean;
            }
        }
    }

}
export class AdminRoom extends EventEmitter {
    public static helpMessage: MatrixMessageContent;
    private widgetAccessToken = `abcdef`;
    static botCommands: BotCommands;

    private pendingOAuthState: string|null = null;

    constructor(public readonly roomId: string,
                public readonly data: AdminAccountData,
                private botIntent: Intent,
                private tokenStore: UserTokenStore,
                private config: BridgeConfig) {
        super();
        // TODO: Move this
        this.backfillAccessToken();
    }

    public get userId() {
        return this.data.admin_user;
    }

    public get oauthState() {
        return this.pendingOAuthState;
    }

    public verifyWidgetAccessToken(token: string) {
        return this.widgetAccessToken === token;
    }

    public notificationsEnabled(type: "github"|"gitlab", instanceName?: string) {
        if (type === "github") {
            return this.data.github?.notifications?.enabled;
        }
        return (type === "gitlab" &&
            !!instanceName &&
            this.data.gitlab &&
            this.data.gitlab[instanceName].notifications.enabled
        );
    }

    public notificationsParticipating(type: string) {
        if (type !== "github") {
            return false;
        }
        return this.data.github?.notifications?.participating || false;
    }

    public clearOauthState() {
        this.pendingOAuthState = null;
    }

    public async getNotifSince(type: "github"|"gitlab", instanceName?: string) {
        if (type === "gitlab") {
            try {
                const { since } = await this.botIntent.underlyingClient.getRoomAccountData(
                    `${BRIDGE_GITLAB_NOTIF_TYPE}:${instanceName}`, this.roomId
                );
                return since;
            } catch {
                // TODO: We should look at this error.
                return 0;
            }
        }
        try {
            const { since } = await this.botIntent.underlyingClient.getRoomAccountData(BRIDGE_NOTIF_TYPE, this.roomId);
            log.debug(`Got ${type} notif-since to ${since}`);
            return since;
        } catch (ex) {
            log.warn(`Filed to get ${type} notif-since`, ex);
            // TODO: We should look at this error.
            return 0;
        }
    }

    public async setNotifSince(type: "github"|"gitlab", since: number, instanceName?: string) {
        log.debug(`Updated ${type} notif-since to ${since}`);
        if (type === "gitlab") {
            return this.botIntent.underlyingClient.setRoomAccountData(
                `${BRIDGE_GITLAB_NOTIF_TYPE}:${instanceName}`,
                this.roomId, {
                since,
            });
        }
        return this.botIntent.underlyingClient.setRoomAccountData(BRIDGE_NOTIF_TYPE, this.roomId, {
            since,
        });
    }

    public async sendNotice(noticeText: string) {
        return this.botIntent.sendText(this.roomId, noticeText, "m.notice");
    }

    @botCommand("help", "This help text")
    public async helpCommand() {
        return this.botIntent.sendEvent(this.roomId, AdminRoom.helpMessage);
    }

    @botCommand("github setpersonaltoken", "Set your personal access token for GitHub", ['accessToken'])
    // @ts-ignore - property is used
    private async setGHPersonalAccessToken(accessToken: string) {
        if (!this.config.github) {
            return this.sendNotice("The bridge is not configured with GitHub support");
        }
        let me;
        try {
            const octokit = GithubInstance.createUserOctokit(accessToken);
            me = await octokit.users.getAuthenticated();
        } catch (ex) {
            log.error("Failed to auth with GitHub", ex);
            await this.sendNotice("Could not authenticate with GitHub. Is your token correct?");
            return;
        }
        await this.sendNotice(`Connected as ${me.data.login}. Token stored`);
        await this.tokenStore.storeUserToken("github", this.userId, accessToken);
    }

    @botCommand("github hastoken", "Check if you have a token stored for GitHub")
    // @ts-ignore - property is used
    private async hasPersonalToken() {
        if (!this.config.github) {
            return this.sendNotice("The bridge is not configured with GitHub support");
        }
        const result = await this.tokenStore.getUserToken("github", this.userId);
        if (result === null) {
            await this.sendNotice("You do not currently have a token stored");
            return;
        }
        await this.sendNotice("A token is stored for your GitHub account.");
    }

    @botCommand("github startoauth", "Start the OAuth process with GitHub")
    // @ts-ignore - property is used
    private async beginOAuth() {
        if (!this.config.github) {
            return this.sendNotice("The bridge is not configured with GitHub support");
        }
        // If this is already set, calling this command will invalidate the previous session.
        this.pendingOAuthState = uuid();
        const q = qs.stringify({
            client_id: this.config.github.oauth.client_id,
            redirect_uri: this.config.github.oauth.redirect_uri,
            state: this.pendingOAuthState,
        });
        const url = `https://github.com/login/oauth/authorize?${q}`;
        await this.sendNotice(`You should follow ${url} to link your account to the bridge`);
    }

    @botCommand("github notifications toggle", "Toggle enabling/disabling GitHub notifications in this room")
    // @ts-ignore - property is used
    private async setGitHubNotificationsStateToggle() {
        const data = await this.saveAccountData((data) => {
            return {
                ...data,
                github: {
                    notifications: {
                        enabled: !(data.github?.notifications?.enabled ?? false),
                        participating: data.github?.notifications?.participating,
                    },
                },
            };
        });
        await this.sendNotice(`${data.github?.notifications?.enabled ? "En" : "Dis"}abled GitHub notifcations`);
    }

    @botCommand("github notifications filter participating", "Toggle enabling/disabling GitHub notifications in this room")
    // @ts-ignore - property is used
    private async setGitHubNotificationsStateParticipating() {
        const data = await this.saveAccountData((data) => {
            if (!data.github?.notifications?.enabled) {
                throw Error('Notifications are not enabled')
            }
            return {
                ...data,
                github: {
                    notifications: {
                        participating: !(data.github?.notifications?.participating ?? false),
                        enabled: true,
                    },
                },
            };
        });
        await this.sendNotice(`${data.github?.notifications?.enabled ? "" : "Not"} filtering for events you are participating in`);
    }

    @botCommand("github project list-for-user", "List GitHub projects for a user", [], ['user', 'repo'])
    // @ts-ignore - property is used
    private async listProjects(username?: string, repo?: string) {
        if (!this.config.github) {
            return this.sendNotice("The bridge is not configured with GitHub support");
        }
        const octokit = await this.tokenStore.getOctokitForUser(this.userId);
        if (!octokit) {
            return this.sendNotice("You can not list projects without an account.");
        }

        if (!username) {
            const me = await octokit.users.getAuthenticated();
            username = me.data.name;
        }

        let res: ProjectsListForUserResponseData|ProjectsListForRepoResponseData;
        try {
            if (repo) {
                res = (await octokit.projects.listForRepo({
                    repo,
                    owner: username,
                })).data;
            }
            res = (await octokit.projects.listForUser({
                username,
            })).data;
        } catch (ex) {
            log.warn(`Failed to fetch projects:`, ex);
            return this.sendNotice(`Failed to fetch projects due to an error. See logs for details`);
        }

        const content = `Projects for ${username}:\n` + res.map(r => ` - ${FormatUtil.projectListing([r])}\n`).join("\n");
        return this.botIntent.sendEvent(this.roomId,{
            msgtype: "m.notice",
            body: content,
            formatted_body: md.render(content),
            format: "org.matrix.custom.html"
        });
    }

    @botCommand("github project list-for-org", "List GitHub projects for an org", ['org'], ['repo'])
    // @ts-ignore - property is used
    private async listProjects(org: string, repo?: string) {
        if (!this.config.github) {
            return this.sendNotice("The bridge is not configured with GitHub support");
        }
        const octokit = await this.tokenStore.getOctokitForUser(this.userId);
        if (!octokit) {
            return this.sendNotice("You can not list projects without an account.");
        }

        let res: ProjectsListForUserResponseData|ProjectsListForRepoResponseData;
        try {
            if (repo) {
                res = (await octokit.projects.listForRepo({
                    repo,
                    owner: org,
                })).data;
            }
            res = (await octokit.projects.listForOrg({
                org,
            })).data;
        } catch (ex) {
            if (ex.status === 404) {
                return this.sendNotice('Not found');
            }
            log.warn(`Failed to fetch projects:`, ex);
            return this.sendNotice(`Failed to fetch projects due to an error. See logs for details`);
        }

        const content = `Projects for ${org}:\n` + res.map(r => ` - ${FormatUtil.projectListing([r])}\n`).join("\n");
        return this.botIntent.sendEvent(this.roomId,{
            msgtype: "m.notice",
            body: content,
            formatted_body: md.render(content),
            format: "org.matrix.custom.html"
        });
    }

    @botCommand("github project open", "Open a GitHub project as a room", ['projectId'])
    // @ts-ignore - property is used
    private async openProject(projectId: string) {
        if (!this.config.github) {
            return this.sendNotice("The bridge is not configured with GitHub support");
        }
        const octokit = await this.tokenStore.getOctokitForUser(this.userId);
        if (!octokit) {
            return this.sendNotice("You can not list projects without an account.");
        }

        try {
            const project = await octokit.projects.get({
                project_id: parseInt(projectId, 10),
            });
            this.emit('open.project', project.data);
        } catch (ex) {
            if (ex.status === 404) {
                return this.sendNotice('Not found');
            }
            log.warn(`Failed to fetch project:`, ex);
            return this.sendNotice(`Failed to fetch project due to an error. See logs for details`);
        }
    }

    @botCommand("github discussion open", "Open a discussion room", ['owner', 'repo', 'number'])
    // @ts-ignore - property is used
    private async listDiscussions(owner: string, repo: string, numberStr: string) {
        const number = parseInt(numberStr);
        if (!this.config.github) {
            return this.sendNotice("The bridge is not configured with GitHub support");
        }
        const octokit = await this.tokenStore.getOctokitForUser(this.userId);
        if (!octokit) {
            return this.sendNotice("You can not list projects without an account.");
        }
        try {
            const graphql = new GithubGraphQLClient(octokit);
            const discussions = await graphql.getDiscussionByNumber(owner, repo, number);
            this.emit('open.discussion', owner, repo, discussions);
        } catch (ex) {
            if (ex.status === 404) {
                return this.sendNotice('Not found');
            }
            log.warn(`Failed to fetch discussions:`, ex);
            return this.sendNotice(`Failed to fetch discussions due to an error. See logs for details`);
        }

    }

    /* GitLab commands */

    @botCommand("gitlab open issue", "Open or join a issue room for GitLab", ['url'])
    // @ts-ignore - property is used
    private async gitLabOpenIssue(url: string) {
        if (!this.config.gitlab) {
            return this.sendNotice("The bridge is not configured with GitLab support");
        }

        const urlResult = GitLabClient.splitUrlIntoParts(this.config.gitlab.instances, url);
        if (!urlResult) {
            return this.sendNotice("The URL was not understood. The URL must be an issue and the bridge must know of the GitLab instance.");
        }
        const [instanceName, parts] = urlResult;
        const instance = this.config.gitlab.instances[instanceName];
        const client = await this.tokenStore.getGitLabForUser(this.userId, instance.url);
        if (!client) {
            return this.sendNotice("You have not added a personal access token for GitLab");
        }
        const getIssueOpts = {
            issue: parseInt(parts[parts.length-1]),
            projects: parts.slice(0, parts.length-3), // Remove - and /issues
        };
        log.info(`Looking up issue ${instanceName} ${getIssueOpts.projects.join("/")}#${getIssueOpts.issue}`);
        const issue = await client.issues.get(getIssueOpts);
        this.emit('open.gitlab-issue', getIssueOpts, issue, instanceName, instance);
    }

    @botCommand("gitlab personaltoken", "Set your personal access token for GitLab", ['instanceName', 'accessToken'])
    // @ts-ignore - property is used
    private async setGitLabPersonalAccessToken(instanceName: string, accessToken: string) {
        let me: GetUserResponse;
        if (!this.config.gitlab) {
            return this.sendNotice("The bridge is not configured with GitLab support");
        }
        const instance = this.config.gitlab.instances[instanceName];
        if (!instance) {
            return this.sendNotice("The bridge is not configured for this GitLab instance");
        }
        try {
            const client = new GitLabClient(instance.url, accessToken);
            me = await client.user();
            client.issues
        } catch (ex) {
            log.error("Gitlab auth error:", ex);
            await this.sendNotice("Could not authenticate with GitLab. Is your token correct?");
            return;
        }
        await this.sendNotice(`Connected as ${me.username}. Token stored`);
        await this.tokenStore.storeUserToken("gitlab", this.userId, accessToken, instance.url);
    }

    @botCommand("gitlab hastoken", "Check if you have a token stored for GitLab", ["instanceName"])
    // @ts-ignore - property is used
    private async gitlabHasPersonalToken(instanceName: string) {
        if (!this.config.gitlab) {
            return this.sendNotice("The bridge is not configured with GitLab support");
        }
        const instance = this.config.gitlab.instances[instanceName];
        if (!instance) {
            return this.sendNotice("The bridge is not configured for this GitLab instance");
        }
        const result = await this.tokenStore.getUserToken("gitlab", this.userId, instance.url);
        if (result === null) {
            await this.sendNotice("You do not currently have a token stored");
            return;
        }
        await this.sendNotice("A token is stored for your GitLab account.");
    }

    @botCommand("gitlab notifications toggle", "Toggle enabling/disabling GitHub notifications in this room", ["instanceName"])
    // @ts-ignore - property is used
    private async setGitLabNotificationsStateToggle(instanceName: string) {
        if (!this.config.gitlab) {
            return this.sendNotice("The bridge is not configured with GitLab support");
        }
        const instance = this.config.gitlab.instances[instanceName];
        if (!instance) {
            return this.sendNotice("The bridge is not configured for this GitLab instance");
        }
        const hasClient = await this.tokenStore.getGitLabForUser(this.userId, instance.url);
        if (!hasClient) {
            return this.sendNotice("You do not have a GitLab token configured for this instance");
        }
        let newValue = false;
        await this.saveAccountData((data) => {
            const currentNotifs = (data.gitlab || {})[instanceName].notifications;
            console.log("current:", currentNotifs.enabled);
            newValue = !currentNotifs.enabled;
            return {
                ...data,
                gitlab: {
                    [instanceName]: {
                        notifications: {
                            enabled: newValue,
                        },
                    }
                },
            };
        });
        await this.sendNotice(`${newValue ? "En" : "Dis"}abled GitLab notifications for ${instanceName}`);
    }

    private async saveAccountData(updateFn: (record: AdminAccountData) => AdminAccountData) {
        const oldData: AdminAccountData = await this.botIntent.underlyingClient.getRoomAccountData(
            BRIDGE_ROOM_TYPE, this.roomId,
        );
        const newData = updateFn(oldData);
        await this.botIntent.underlyingClient.setRoomAccountData(BRIDGE_ROOM_TYPE, this.roomId, newData);
        this.emit("settings.changed", this, oldData, newData);
        return newData;
    }

    public async handleCommand(eventId: string, command: string) {
        const { error, handled } = await handleCommand(this.userId, command, AdminRoom.botCommands, this);
        if (!handled) {
            return this.sendNotice("Command not understood");
        }
        if (error) {
            return this.sendNotice("Failed to handle command:" + error);
        }
        return null;
        // return this.botIntent.underlyingClient.sendEvent(this.roomId, "m.reaction", {
        //     "m.relates_to": {
        //         rel_type: "m.annotation",
        //         event_id: event_id,
        //         key: "✅",
        //     }
        // });
    }

    public async getBridgeState(): Promise<BridgeRoomState> {
        const gitHubEnabled = !!this.config.github;
        const github: BridgeRoomStateGitHub = {
            enabled: false,
            tokenStored: false,
            identity: null,
            notifications: false,
        };
        if (gitHubEnabled) {
            const octokit = await this.tokenStore.getOctokitForUser(this.userId);
            try {
                const identity = await octokit?.users.getAuthenticated();
                github.enabled = true;
                github.tokenStored = !!octokit;
                github.identity = {
                    name: identity?.data.login || null,
                    avatarUrl: identity?.data.avatar_url || null,
                };
                github.notifications = this.notificationsEnabled("github") || false;
            } catch (ex) {
                log.warn(`Failed to get user identity: ${ex}`);
            }
        }
        
        return {
            title: "Admin Room",
            github,
        }
    }

    public async setupWidget() {
        try {
            const res = await this.botIntent.underlyingClient.getRoomStateEvent(this.roomId, "im.vector.modular.widgets", "bridge_control");
            if (res) {
                // No-op
                // Validate?
                return;
            }
        } catch (ex) {
            // Didn't exist, create it.
        }
        const accessToken = uuid();
        return this.botIntent.underlyingClient.sendStateEvent(
            this.roomId,
            "im.vector.modular.widgets",
            "bridge_control",
            {
                "creatorUserId": this.botIntent.userId,
                "data": {
                  "title": "Bridge Control"
                },
                "id": "bridge_control",
                "name": "Bridge Control",
                "type": "m.custom",
                "url": `${this.config.widgets?.publicUrl}/#/?roomId=$matrix_room_id&widgetId=$matrix_widget_id&accessToken=${accessToken}`,
                accessToken,
                "waitForIframeLoad": true
            }
        );
    }

    private async backfillAccessToken() {
        try {
            const res = await this.botIntent.underlyingClient.getRoomStateEvent(this.roomId, "im.vector.modular.widgets", "bridge_control");
            if (res) {
                log.debug(`Stored access token for widgets for ${this.roomId}`);
                this.widgetAccessToken = res.accessToken;
            }
        } catch (ex) {
            log.info(`No widget access token for ${this.roomId}`);
        }
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const res = compileBotCommands(AdminRoom.prototype as any);
AdminRoom.helpMessage = res.helpMessage;
AdminRoom.botCommands = res.botCommands;