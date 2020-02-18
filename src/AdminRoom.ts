import { Intent } from "matrix-bot-sdk";
import { Octokit } from "@octokit/rest";
import { createTokenAuth } from "@octokit/auth-token";
import { UserTokenStore } from "./UserTokenStore";
import { BridgeConfig } from "./Config";
import uuid from "uuid/v4";
import qs from "querystring";

export const BRIDGE_ROOM_TYPE = "uk.half-shot.matrix-github.room";
export const BRIDGE_NOTIF_TYPE = "uk.half-shot.matrix-github.notif_state";

export interface AdminAccountData {
    admin_user: string;
    notifications?: {
        enabled: boolean;
    }
}

export class AdminRoom {

    private pendingOAuthState: string|null = null;

    constructor(private roomId: string,
                public readonly data: AdminAccountData,
                private botIntent: Intent,
                private tokenStore: UserTokenStore,
                private config: BridgeConfig) {

    }

    public get userId() {
        return this.data.admin_user;
    }

    public get oauthState() {
        return this.pendingOAuthState;
    }

    public get notificationsEnabled() {
        return this.data.notifications?.enabled;
    }

    public clearOauthState() {
        this.pendingOAuthState = null;
    }

    public async getNotifSince() {
        try {
            const { since } = await this.botIntent.underlyingClient.getRoomAccountData(BRIDGE_NOTIF_TYPE, this.roomId);
            console.log(`getNotifSince for ${this.roomId} = ${since}`);
            return since;
        } catch {
            // TODO: We should look at this error.
            return 0;
        }
    }
    public async setNotifSince(since: number) {
        console.log(`setNotifSince for ${this.roomId} = ${since}`);
        return this.botIntent.underlyingClient.setRoomAccountData(BRIDGE_NOTIF_TYPE, this.roomId, {
            since,
        });
    }

    public async handleCommand(command: string) {
        const cmdLower = command.toLowerCase();
        if (cmdLower.startsWith("setpersonaltoken ")) {
            const accessToken = command.substr("setPersonalToken ".length);
            return this.setPersonalAccessToken(accessToken);
        } else if (cmdLower.startsWith("hastoken")) {
            return this.hasPersonalToken();
        } else if (cmdLower.startsWith("startoauth")) {
            return this.beginOAuth();
        } else if (cmdLower.startsWith("notifications enable")) {
            // TODO: Check if we can do this.
            return this.setNotificationsState(true);
        } else if (cmdLower.startsWith("notifications disable")) {
            return this.setNotificationsState(false);
        }
        await this.sendNotice("Command not understood");
    }

    private async setPersonalAccessToken(accessToken: string) {
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
        await this.sendNotice(`Connected as ${me.data.login}. Storing token..`);
        await this.tokenStore.storeUserToken(this.userId, accessToken);
    }

    private async hasPersonalToken() {
        const result = await this.tokenStore.getUserToken(this.userId);
        if (result === null) {
            await this.sendNotice("You do not currently have a token stored");
            return;
        }
        await this.sendNotice("A token is stored for your GitHub account.");
    }

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

    private async setNotificationsState(enabled: boolean) {
        const data: AdminAccountData = await this.botIntent.underlyingClient.getRoomAccountData(BRIDGE_ROOM_TYPE, this.roomId);
        if (data.notifications?.enabled === enabled) {
            return this.sendNotice(`Notifications are already ${enabled ? "en" : "dis"}abled`);
        }
        data.notifications = { enabled };
        await this.botIntent.underlyingClient.setRoomAccountData(BRIDGE_ROOM_TYPE, this.roomId, data);
        return this.sendNotice(`${enabled ? "En" : "Dis"}abled GitHub notifcations`);
    }

    private async sendNotice(noticeText: string) {
        return this.botIntent.sendText(this.roomId, noticeText, "m.notice");
    }
}
