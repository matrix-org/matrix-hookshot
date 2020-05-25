import { Intent } from "matrix-bot-sdk";
import { Octokit } from "@octokit/rest";
import { createTokenAuth } from "@octokit/auth-token";
import { UserTokenStore } from "./UserTokenStore";
import { BridgeConfig } from "./Config";
import uuid from "uuid/v4";
import qs from "querystring";
import { EventEmitter } from "events";
import moment from "moment";
import DateFormat from "./DateFormat";

export const BRIDGE_ROOM_TYPE = "uk.half-shot.matrix-github.room";
export const BRIDGE_NOTIF_TYPE = "uk.half-shot.matrix-github.notif_state";

export interface AdminAccountData {
    admin_user: string;
    notifications?: {
        enabled: boolean;
        participating?: boolean;
        snoozeUntil?: number;
    };
}

export class AdminRoom extends EventEmitter {

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

    public get snoozeUntil() {
        return this.data.notifications?.snoozeUntil;
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

    private async setPersonalAccessToken(accessToken: string) {
        if (!accessToken) {
            return this.sendNotice("You need to provide a token as the second argument");
        }
        let me;
        try {
            const octokit = new Octokit({
                authStrategy: createTokenAuth,
                auth: accessToken,
                userAgent: "matrix-github v0.0.1",
            });
            me = await octokit.users.getAuthenticated();
        } catch (ex) {
            return this.sendNotice("Could not authenticate with GitHub. Is your token correct?");
        }
        await this.sendNotice(`Connected as ${me.data.login}. Storing token..`);
        return this.tokenStore.storeUserToken(this.userId, accessToken);
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

    private async setNotificationsState(enabled: boolean, participating: boolean = false, snoozeUntil?: Date) {
        const data: AdminAccountData = await this.botIntent.underlyingClient.getRoomAccountData(
            BRIDGE_ROOM_TYPE, this.roomId,
        );
        const oldState = data.notifications;
        data.notifications = { enabled, participating, snoozeUntil: snoozeUntil ? Number(snoozeUntil) : undefined};
        await this.botIntent.underlyingClient.setRoomAccountData(BRIDGE_ROOM_TYPE, this.roomId, data);
        this.emit("settings.changed", this, data);
        if (oldState?.enabled !== enabled) {
            await this.sendNotice(`${enabled ? "En" : "Dis"}abled GitHub notifcations`);
        }
        if (oldState?.participating !== participating) {
            await this.sendNotice(`${enabled ? "En" : "Dis"}abled filtering for participating notifications`);
        }
        if (typeof(oldState?.snoozeUntil) !== "number" && !snoozeUntil) {
            // Do Nothing
        }
        else if (snoozeUntil) {
            await this.sendNotice(`"Will not send notifications. Sending will resume ${moment(snoozeUntil).fromNow()}`);
        }
        else if (!snoozeUntil) {
            await this.sendNotice(`"Unsnoozed notifications.`);
        }
    }

    private async snoozeNotifications(time: string) {
        try {
            const snoozeUntil = DateFormat.parseUntilOrForDateString(time);
            this.setNotificationsState(this.notificationsEnabled, this.notificationsParticipating, snoozeUntil);
        } catch (ex) {
            await this.sendNotice(`Couldn't set snooze time: ${ex.message}`);
        }
    }

    public handleCommand(command: string) {
        const args = command.toLowerCase().split(" ");
        switch(args[0]) {
            case "setpersonaltoken":
                return this.setPersonalAccessToken(args[1]);
            case "hastoken":
                return this.hasPersonalToken();
            case "startoauth":
                return this.beginOAuth();
            case "notifications":
                // Submenu
                return this.handleNotificationsCommand(args.slice(1));
        }
        return this.sendNotice("Command not understood");
    }

    public handleNotificationsCommand(args: string[]) {
        switch(args[0]) {
            case "toggle":
                return this.setNotificationsState(!this.notificationsEnabled);
            case "filter":
                return this.setNotificationsState(!this.notificationsEnabled, !this.notificationsParticipating);
            case "snooze":
                return this.snoozeNotifications(args.slice(1).join(" "));
        }
        return this.sendNotice("Command not understood");
    }
}
