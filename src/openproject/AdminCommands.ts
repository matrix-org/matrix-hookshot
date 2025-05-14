import { AdminRoomCommandHandler, Category } from "../AdminRoomCommandHandler";
import { botCommand } from "../BotCommands";
import { Logger } from "matrix-appservice-bridge";
import { BridgePermissionLevel } from "../config/Config";

const log = new Logger("OpenProjectBotCommands");

export class OpenProjectBotCommands extends AdminRoomCommandHandler {
  @botCommand("openproject login", {
    help: "Log in to OpenProject",
    category: Category.OpenProject,
    permissionLevel: BridgePermissionLevel.login,
  })
  public async loginCommand() {
    if (!this.tokenStore.openProjectOAuth) {
      this.sendNotice(`Bot is not configured with JIRA OAuth support.`);
      return;
    }
    const state = this.tokenStore.createStateForOAuth(this.userId);
    const url = await this.tokenStore.openProjectOAuth.getAuthUrl(state);
    await this.sendNotice(`Open ${url} to link your account to the bridge.`);
  }

  @botCommand("openproject logout", {
    help: "Log out of OpenProject",
    category: Category.OpenProject,
    permissionLevel: BridgePermissionLevel.login,
  })
  public async logoutCommand() {
    if (await this.tokenStore.clearUserToken("openproject", this.userId)) {
      return this.sendNotice(`You have been logged out of OpenProject.`);
    }
    return this.sendNotice(`You are not logged into OpenProject.`);
  }
}
