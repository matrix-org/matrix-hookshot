import qs from "querystring";
import { AdminRoomCommandHandler } from "../AdminRoomCommandHandler"
import { botCommand } from "../BotCommands";
import { CommandError, TokenError, TokenErrorCode } from "../errors";
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
    @botCommand("github login", {help: "Log in to GitHub", category: "github"})
    public async loginCommand() {
        if (!this.config.github) {
            throw new CommandError("no-github-support", "The bridge is not configured with GitHub support.");
        }
        if (!this.config.github.oauth) {
            throw new CommandError("no-github-support", "The bridge is not configured with GitHub OAuth support.");
        }
        const state = this.tokenStore.createStateForOAuth(this.userId);
        return this.sendNotice(`Open ${generateGitHubOAuthUrl(this.config.github.oauth.client_id, this.config.github.oauth.redirect_uri, state)} to link your account to the bridge.`);
    }

    @botCommand("github setpersonaltoken", {help: "Set your personal access token for GitHub", requiredArgs: ['accessToken'], category: "github"})
    public async setGHPersonalAccessToken(accessToken: string) {
        if (!this.config.github) {
            throw new CommandError("no-github-support", "The bridge is not configured with GitHub support.");
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
        await this.sendNotice(`Connected as ${me.data.login}. Token stored.`);
        await this.tokenStore.storeUserToken("github", this.userId, JSON.stringify({access_token: accessToken, token_type: 'pat'} as GitHubOAuthToken));
    }

    @botCommand("github status", {help: "Check the status of your GitHub authentication", category: "github"})
    public async getTokenStatus() {
        if (!this.config.github) {
            throw new CommandError("no-github-support", "The bridge is not configured with GitHub support.");
        }
       try {
            const octokit = await this.tokenStore.getOctokitForUser(this.userId);
            if (octokit === null) {
                await this.sendNotice("You are not authenticated, please login.");
                return;
            }
            const me = await octokit.users.getAuthenticated();
            this.sendNotice(`You are logged in as ${me.data.login}`);    
        } catch (ex) {
            if (ex instanceof TokenError && ex.code === TokenErrorCode.EXPIRED) {
                await this.sendNotice("Your authentication is no longer valid, please login again.");
            }
        }
    }
}
