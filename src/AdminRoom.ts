import { Intent } from "matrix-bot-sdk";
import { Octokit } from "@octokit/rest";
import { createTokenAuth } from "@octokit/auth-token";
import { UserTokenStore } from "./UserTokenStore";
import { BridgeConfig } from "./Config";
import uuid from "uuid/v4";
import qs from "querystring";
import { EventEmitter } from "events";
import LogWrapper from "./LogWrapper";
import "reflect-metadata";
import markdown from "markdown-it";
import { FormatUtil } from "./FormatUtil";
import { botCommand, compileBotCommands, handleCommand, BotCommands } from "./BotCommands";
import { GitLabClient } from "./Gitlab/Client";

const md = new markdown();
const log = new LogWrapper('AdminRoom');

export const BRIDGE_ROOM_TYPE = "uk.half-shot.matrix-github.room";
export const BRIDGE_NOTIF_TYPE = "uk.half-shot.matrix-github.notif_state";

export interface AdminAccountData {
    admin_user: string;
    notifications?: {
        enabled: boolean;
        participating?: boolean;
    };
}
export class AdminRoom extends EventEmitter {
    static helpMessage: any;
    static botCommands: BotCommands;

    private pendingOAuthState: string|null = null;

    constructor(public readonly roomId: string,
                public readonly data: AdminAccountData,
                private botIntent: Intent,
                private tokenStore: UserTokenStore,
                private config: BridgeConfig) {
        super();
    }

    public get userId() {
        return this.data.admin_user;
    }

    public get oauthState() {
        return this.pendingOAuthState;
    }

    public get notificationsEnabled() {
        return !!this.data.notifications?.enabled;
    }

    public get notificationsParticipating() {
        return !!this.data.notifications?.participating;
    }

    public clearOauthState() {
        this.pendingOAuthState = null;
    }

    public async getNotifSince() {
        try {
            const { since } = await this.botIntent.underlyingClient.getRoomAccountData(BRIDGE_NOTIF_TYPE, this.roomId);
            return since;
        } catch {
            // TODO: We should look at this error.
            return 0;
        }
    }

    public async setNotifSince(since: number) {
        return this.botIntent.underlyingClient.setRoomAccountData(BRIDGE_NOTIF_TYPE, this.roomId, {
            since,
        });
    }

    public async sendNotice(noticeText: string) {
        return this.botIntent.sendText(this.roomId, noticeText, "m.notice");
    }

    @botCommand("help", "This help text")
    public async helpCommand() {
        return this.botIntent.underlyingClient.sendMessage(this.roomId, AdminRoom.helpMessage);
    }

    @botCommand("setpersonaltoken", "Set your personal access token for GitHub", ['accessToken'])
    // @ts-ignore - property is used
    private async setGHPersonalAccessToken(accessToken: string) {
        let me;
        try {
            const octokit = new Octokit({
                authStrategy: createTokenAuth,
                auth: accessToken,
                userAgent: "matrix-github v0.0.1",
            });
            me = await octokit.users.getAuthenticated();
        } catch (ex) {
            await this.sendNotice("Could not authenticate with GitHub. Is your token correct?");
            return;
        }
        await this.sendNotice(`Connected as ${me.data.login}. Token stored`);
        await this.tokenStore.storeUserToken("github", this.userId, accessToken);
    }

    @botCommand("gitlab personaltoken", "Set your personal access token for GitLab", ['instanceUrl', 'accessToken'])
    // @ts-ignore - property is used
    private async setGitLabPersonalAccessToken(instanceUrl: string, accessToken: string) {
        let me: GetUserResponse;
        try {
            const client = new GitLabClient(instanceUrl, accessToken);
            me = await client.user();
        } catch (ex) {
            log.error("Gitlab auth error:", ex);
            await this.sendNotice("Could not authenticate with GitLab. Is your token correct?");
            return;
        }
        await this.sendNotice(`Connected as ${me.username}. Token stored`);
        await this.tokenStore.storeUserToken("gitlab", this.userId, accessToken, instanceUrl);
    }

    @botCommand("hastoken", "Check if you have a token stored for GitHub")
    // @ts-ignore - property is used
    private async hasPersonalToken() {
        const result = await this.tokenStore.getUserToken("github", this.userId);
        if (result === null) {
            await this.sendNotice("You do not currently have a token stored");
            return;
        }
        await this.sendNotice("A token is stored for your GitHub account.");
    }

    @botCommand("startoauth", "Start the OAuth process with GitHub")
    // @ts-ignore - property is used
    private async beginOAuth() {
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

    @botCommand("notifications toggle", "Toggle enabling/disabling GitHub notifications in this room")
    // @ts-ignore - property is used
    private async setNotificationsStateToggle() {
        const data: AdminAccountData = await this.botIntent.underlyingClient.getRoomAccountData(
            BRIDGE_ROOM_TYPE, this.roomId,
        );
        const oldState = data.notifications || {
            enabled: false,
            participating: true,
        };
        data.notifications = { enabled: !oldState?.enabled, participating: oldState?.participating };
        await this.botIntent.underlyingClient.setRoomAccountData(BRIDGE_ROOM_TYPE, this.roomId, data);
        this.emit("settings.changed", this, data);
        await this.sendNotice(`${data.notifications.enabled ? "En" : "Dis"}abled GitHub notifcations`);
    }

    @botCommand("notifications filter participating", "Toggle enabling/disabling GitHub notifications in this room")
    // @ts-ignore - property is used
    private async setNotificationsStateParticipating() {
        const data: AdminAccountData = await this.botIntent.underlyingClient.getRoomAccountData(
            BRIDGE_ROOM_TYPE, this.roomId,
        );
        const oldState = data.notifications || {
            enabled: false,
            participating: true,
        };
        data.notifications = { enabled: oldState?.enabled, participating: !oldState?.participating };
        await this.botIntent.underlyingClient.setRoomAccountData(BRIDGE_ROOM_TYPE, this.roomId, data);
        this.emit("settings.changed", this, data);
        await this.sendNotice(`${data.notifications.participating ? "En" : "Dis"}abled filtering for participating notifications`); 
    }

    @botCommand("project list-for-user", "List GitHub projects for a user", [], ['user', 'repo'])
    // @ts-ignore - property is used
    private async listProjects(username?: string, repo?: string) {
        const octokit = await this.tokenStore.getOctokitForUser(this.userId);
        if (!octokit) {
            return this.sendNotice("You can not list projects without an account.");
        }

        if (!username) {
            const me = await octokit.users.getAuthenticated();
            username = me.data.name;
        }

        let res: Octokit.ProjectsListForUserResponse|Octokit.ProjectsListForRepoResponse;
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

        const content = `Projects for ${username}:\n` + res.map(r => ` - ${FormatUtil.projectListing(r)}\n`).join("\n");
        return this.botIntent.sendEvent(this.roomId,{
            msgtype: "m.notice",
            body: content,
            formatted_body: md.render(content),
            format: "org.matrix.custom.html"
        });
    }

    @botCommand("project list-for-org", "List GitHub projects for an org", ['org'], ['repo'])
    // @ts-ignore - property is used
    private async listProjects(org: string, repo?: string) {
        const octokit = await this.tokenStore.getOctokitForUser(this.userId);
        if (!octokit) {
            return this.sendNotice("You can not list projects without an account.");
        }

        let res: Octokit.ProjectsListForUserResponse|Octokit.ProjectsListForRepoResponse;
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
            log.warn(`Failed to fetch projects:`, ex);
            return this.sendNotice(`Failed to fetch projects due to an error. See logs for details`);
        }

        const content = `Projects for ${org}:\n` + res.map(r => ` - ${FormatUtil.projectListing(r)}\n`).join("\n");
        return this.botIntent.sendEvent(this.roomId,{
            msgtype: "m.notice",
            body: content,
            formatted_body: md.render(content),
            format: "org.matrix.custom.html"
        });
    }

    @botCommand("project open", "Open a GitHub project as a room", [], ['projectId'])
    // @ts-ignore - property is used
    private async openProject(projectId: string) {
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
            log.warn(`Failed to fetch project:`, ex);
            return this.sendNotice(`Failed to fetch project due to an error. See logs for details`);
        }
    }

    public async handleCommand(event_id: string, command: string) {
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
}

const res = compileBotCommands(AdminRoom.prototype);
AdminRoom.helpMessage = res.helpMessage;
AdminRoom.botCommands = res.botCommands;