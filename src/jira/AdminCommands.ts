import { AdminRoomCommandHandler, Category } from "../AdminRoomCommandHandler";
import { botCommand } from "../BotCommands";
import { JiraAPIAccessibleResource } from "./Types";
import { Logger } from "matrix-appservice-bridge";
import { BridgePermissionLevel } from "../config/Config";

const log = new Logger('JiraBotCommands');

export class JiraBotCommands extends AdminRoomCommandHandler {
    @botCommand("jira login", {help: "Log in to JIRA", category: Category.Jira, permissionLevel: BridgePermissionLevel.login})
    public async loginCommand() {
        if (!this.config.jira?.oauth || !this.tokenStore.jiraOAuth) {
            this.sendNotice(`Bot is not configured with JIRA OAuth support.`);
            return;
        }
        const state = this.tokenStore.createStateForOAuth(this.userId);
        const url = await this.tokenStore.jiraOAuth?.getAuthUrl(state);
        await this.sendNotice(`Open ${url} to link your account to the bridge.`);
    }


    @botCommand("jira logout", {help: "Clear any login information", category: Category.Jira, permissionLevel: BridgePermissionLevel.login})
    public async logout() {
        if (!this.config.jira?.oauth || !this.tokenStore.jiraOAuth) {
            this.sendNotice(`Bot is not configured with JIRA OAuth support.`);
            return;
        }
        if (await this.tokenStore.clearUserToken("jira", this.userId, this.config.jira.instanceName)) {
            return this.sendNotice(`Your JIRA account has been unlinked from your Matrix user.`);
        }
        return this.sendNotice(`No JIRA account was linked to your Matrix user.`);
    }

    @botCommand("jira whoami", {help: "Determine JIRA identity", category: Category.Jira, permissionLevel: BridgePermissionLevel.login})
    public async whoami() {
        if (!this.config.jira) {
            await this.sendNotice(`Bot is not configured with JIRA OAuth support.`);
            return;
        }
        const client = await this.tokenStore.getJiraForUser(this.userId, this.config.jira.url);
        
        if (!client) {
            await this.sendNotice(`You are not logged into JIRA.`);
            return;
        }
        // Get all resources for user
        let resources: JiraAPIAccessibleResource[];
        try {
            resources = await client.getAccessibleResources();
        } catch (ex) {
            log.warn(`Could not request resources from JIRA API: `, ex);
            await this.sendNotice(`Could not request JIRA resources due to an error.`);
            return;
        }
        let response = resources.length === 0 ?  `You do not have any instances authorised with this bot.` : 'You have access to the following instances:';
        for (const resource of resources) {
            const clientForResource = await client.getClientForResource(resource);
            if (!clientForResource) {
                continue;
            }
            const user = await clientForResource.getCurrentUser();
            response +=
                `\n - ${resource.name}` +
                (user.name ? ` ${user.name}` : "") +
                (user.displayName ? ` (${user.displayName})` : "");
        }
        await this.sendNotice(response);
    }
}
