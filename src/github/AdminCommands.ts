import { AdminRoomCommandHandler, Category } from "../AdminRoomCommandHandler"
import { botCommand } from "../BotCommands";
import { CommandError, TokenError, TokenErrorCode } from "../errors";
import { GithubInstance } from "./GithubInstance";
import { GitHubOAuthToken } from "./Types";
import { Logger } from "matrix-appservice-bridge";
import { BridgePermissionLevel } from "../config/Config";

const log = new Logger('GitHubBotCommands');
export class GitHubBotCommands extends AdminRoomCommandHandler {
    @botCommand("github login", {help: "Log in to GitHub", category: Category.Github, permissionLevel: BridgePermissionLevel.login})
    public async loginCommand() {
        if (!this.config.github) {
            throw new CommandError("no-github-support", "The bridge is not configured with GitHub support.");
        }
        if (!this.config.github.oauth) {
            throw new CommandError("no-github-support", "The bridge is not configured with GitHub OAuth support.");
        }
        const state = this.tokenStore.createStateForOAuth(this.userId);
        const url = GithubInstance.generateOAuthUrl(
            this.config.github.baseUrl,
            "authorize",
            {
                state,
                client_id: this.config.github.oauth.client_id,
                redirect_uri: this.config.github.oauth.redirect_uri,
            }
        );
        return this.sendNotice(`Open ${url} to link your account to the bridge.`);
    }

    @botCommand("github setpersonaltoken", {help: "Set your personal access token for GitHub", requiredArgs: ['accessToken'], category: Category.Github, permissionLevel: BridgePermissionLevel.login})
    public async setGHPersonalAccessToken(accessToken: string) {
        if (!this.config.github) {
            throw new CommandError("no-github-support", "The bridge is not configured with GitHub support.");
        }
        let me;
        try {
            const octokit = GithubInstance.createUserOctokit(accessToken, this.config.github.baseUrl);
            me = await octokit.users.getAuthenticated();
        } catch (ex) {
            log.error("Failed to auth with GitHub", ex);
            await this.sendNotice("Could not authenticate with GitHub. Is your token correct?");
            return;
        }
        await this.tokenStore.storeUserToken("github", this.userId, JSON.stringify({access_token: accessToken, token_type: 'pat'} as GitHubOAuthToken));
        await this.sendNotice(`Connected as ${me.data.login}. Token stored.`);
    }

    @botCommand("github status", {help: "Check the status of your GitHub authentication", category: Category.Github, permissionLevel: BridgePermissionLevel.login})
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
            } else {
                // Generic catch-all.
                await this.sendNotice("The bridge was unable to authenticate as you, please login again.");
            }
        }
    }
}
