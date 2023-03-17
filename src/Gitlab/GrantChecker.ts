import { Appservice } from "matrix-bot-sdk";
import { BridgeConfigGitLab } from "../Config/Config";
import { GitLabRepoConnection } from "../Connections";
import { GrantChecker } from "../grants/GrantCheck";
import { UserTokenStore } from "../UserTokenStore";

interface GitLabGrantConnectionId{
    instance: string;
    path: string;
}



export class GitLabGrantChecker extends GrantChecker<GitLabGrantConnectionId> {
    constructor(private readonly as: Appservice, private readonly config: BridgeConfigGitLab, private readonly tokenStore: UserTokenStore) {
        super(as.botIntent, "gitlab")
    }

    protected async checkFallback(roomId: string, connectionId: GitLabGrantConnectionId, sender?: string) {
        if (!sender) {
            // Cannot validate without a sender.
            return false;
        }
        if (this.as.isNamespacedUser(sender)) {
            // Bridge is always valid.
            return true;
        }
        try {
            await GitLabRepoConnection.assertUserHasAccessToProject(connectionId.instance, connectionId.path, sender, this.tokenStore, this.config);
            return true;
        } catch (ex) {
            return false;
        }
    }
}