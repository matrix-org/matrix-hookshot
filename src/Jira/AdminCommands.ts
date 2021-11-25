import { AdminRoomCommandHandler } from "../AdminRoomCommandHandler";
import { botCommand } from "../BotCommands";
import qs from "querystring";
import {v4 as uuid} from "uuid";
import { JiraAPIAccessibleResource } from "./Types";
import LogWrapper from "../LogWrapper";

const log = new LogWrapper('JiraBotCommands');

const JiraOAuthScopes = [
    // Reading issues, comments
    "read:jira-work",
    // Creating issues, comments
    "write:jira-work",
    // Reading user
    "read:jira-user",
    "read:me",
    "read:account",
    // To get a refresh token
    "offline_access",
];

export class JiraBotCommands extends AdminRoomCommandHandler {
    @botCommand("jira login", "Login to JIRA")
    public async loginCommand() {
        if (!this.config.jira?.oauth) {
            this.sendNotice(`Bot is not configured with JIRA OAuth support`);
            return;
        }
        this.pendingJiraOAuthState = uuid();
        const options = {
            audience: "api.atlassian.com",
            client_id: this.config.jira.oauth.client_id,
            scope: JiraOAuthScopes.join(" "),
            redirect_uri: this.config.jira.oauth.redirect_uri,
            state: this.pendingJiraOAuthState,
            response_type: "code",
            prompt: "consent",
        };
        const url = `https://auth.atlassian.com/authorize?${qs.stringify(options)}`;
        await this.sendNotice(`To login, open ${url} and follow the steps`);
    }

    @botCommand("jira whoami", "Determine JIRA identity")
    public async whoami() {
        if (!this.config.jira) {
            await this.sendNotice(`Bot is not configured with JIRA OAuth support`);
            return;
        }
        const client = await this.tokenStore.getJiraForUser(this.userId);
        
        if (!client) {
            await this.sendNotice(`You are not logged into JIRA`);
            return;
        }
        // Get all resources for user
        let resources: JiraAPIAccessibleResource[];
        try {
            resources = await client.getAccessibleResources();
        } catch (ex) {
            log.warn(`Could not request resources from JIRA API: `, ex);
            await this.sendNotice(`Could not request JIRA resources due to an error`);
            return;
        }
        let response = resources.length === 0 ?  `You do not have any instances authorised with this bot` : 'You have access to the following instances:';
        for (const resource of resources) {
            const user = await (await client.getClientForResource(resource)).getCurrentUser();
            response += `\n - ${resource.name} ${user.name} (${user.displayName || ""})`;
        }
        await this.sendNotice(response);
    }
}