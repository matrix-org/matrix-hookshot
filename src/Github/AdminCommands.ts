import qs from "querystring";
import { AdminRoomCommandHandler } from "../AdminRoomCommandHandler"
import { botCommand } from "../BotCommands";
import { CommandError } from "../errors";
import { GithubInstance } from "./GithubInstance";
import { GitHubOAuthToken } from "./Types";
import LogWrapper from "../LogWrapper";

const log = new LogWrapper('GitHubBotCommands');


export function generateGitHubOAuthUrl(clientId: string, redirectUri: string, state: string) {
    const q = qs.stringify({
        client_id: clientId,
        redirect_uri: redirectUri,
        state: state,
    });
    const url = `https://github.com/login/oauth/authorize?${q}`;
    return url;
}

export class GitHubBotCommands extends AdminRoomCommandHandler {
    @botCommand("github login", "Login to GitHub")
    public async loginCommand() {
        if (!this.config.github) {
            throw new CommandError("no-github-support", "The bridge is not configured with GitHub support");
        }
        if (!this.config.github.oauth) {
            throw new CommandError("no-github-support", "The bridge is not configured with GitHub OAuth support");
        }
        const state = this.tokenStore.createStateForOAuth(this.userId);
        return this.sendNotice(`To login, open ${generateGitHubOAuthUrl(this.config.github.oauth.client_id, this.config.github.oauth.redirect_uri, state)} to link your account to the bridge`);
    }

    @botCommand("github startoauth", "Start the OAuth process with GitHub")
    public async beginOAuth() {
        // Legacy command
        return this.loginCommand();
    }

    @botCommand("github setpersonaltoken", "Set your personal access token for GitHub", ['accessToken'])
    public async setGHPersonalAccessToken(accessToken: string) {
        if (!this.config.github) {
            throw new CommandError("no-github-support", "The bridge is not configured with GitHub support");
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
        await this.tokenStore.storeUserToken("github", this.userId, JSON.stringify({access_token: accessToken, token_type: 'pat'} as GitHubOAuthToken));
    }

    @botCommand("github hastoken", "Check if you have a token stored for GitHub")
    public async hasPersonalToken() {
        if (!this.config.github) {
            throw new CommandError("no-github-support", "The bridge is not configured with GitHub support");
        }
        const result = await this.tokenStore.getUserToken("github", this.userId);
        if (result === null) {
            await this.sendNotice("You do not currently have a token stored");
            return;
        }
        await this.sendNotice("A token is stored for your GitHub account.");
    }
}
