import { Intent } from "matrix-bot-sdk";
import Octokit, {  } from "@octokit/rest";
import { UserTokenStore } from "./UserTokenStore";

export const BRIDGE_ROOM_TYPE = "uk.half-shot.matrix-github.room";

export class AdminRoom {

    constructor(private roomId: string,
                readonly userId: string,
                private botIntent: Intent,
                private tokenStore: UserTokenStore) {

    }

    public async handleCommand(command: string) {
        if (command.startsWith("!setToken ")) {
            const accessToken = command.substr("!setToken ".length);
            await this.setPersonalAccessToken(accessToken);
            return;
        } else if (command.startsWith("!hasToken")) {
            await this.hasPersonalToken();
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

    private async sendNotice(noticeText: string) {
        return this.botIntent.sendText(this.roomId, noticeText, "m.notice");
    }
    // Initiate oauth
    // Relinquish oauth
}
