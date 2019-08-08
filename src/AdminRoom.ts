import { Intent } from "matrix-bot-sdk";
import Octokit, {  } from "@octokit/rest";
import { UserTokenStore } from "./UserTokenStore";
import { BridgeConfig } from "./Config";
import uuid from "uuid/v4";
import qs from "querystring";

export const BRIDGE_ROOM_TYPE = "uk.half-shot.matrix-github.room";

export class AdminRoom {

    private pendingOAuthState: string|null = null;

    constructor(private roomId: string,
                public readonly userId: string,
                private botIntent: Intent,
                private tokenStore: UserTokenStore,
                private config: BridgeConfig) {

    }

    public get oauthState() {
        return this.pendingOAuthState;
    }

    public clearOauthState() {
        this.pendingOAuthState = null;
    }

    public async handleCommand(command: string) {
        const cmdLower = command.toLowerCase();
        if (cmdLower.startsWith("!setpersonaltoken ")) {
            const accessToken = command.substr("!setPersonalToken ".length);
            await this.setPersonalAccessToken(accessToken);
            return;
        } else if (cmdLower.startsWith("!hastoken")) {
            await this.hasPersonalToken();
            return;
        } else if (cmdLower.startsWith("!startoauth")) {
            await this.beginOAuth();
            return;
        }
        await this.sendNotice("Command not understood");
    }

    private async setPersonalAccessToken(accessToken: string) {
        let me;
        try {
            const octokit = new Octokit({
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

    private async sendNotice(noticeText: string) {
        return this.botIntent.sendText(this.roomId, noticeText, "m.notice");
    }
    // Initiate oauth
    // Relinquish oauth
}
