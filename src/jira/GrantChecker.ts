import { Appservice } from "matrix-bot-sdk";
import { JiraProjectConnection } from "../Connections";
import { GrantChecker } from "../grants/GrantCheck";
import { UserTokenStore } from "../tokens/UserTokenStore";

interface JiraGrantConnectionId{
    url: string;
}



export class JiraGrantChecker extends GrantChecker<JiraGrantConnectionId> {
    constructor(private readonly as: Appservice, private readonly tokenStore: UserTokenStore) {
        super(as.botIntent, "jira")
    }

    protected async checkFallback(roomId: string, connectionId: JiraGrantConnectionId, sender?: string) {
        if (!sender) {
            // Cannot validate without a sender.
            return false;
        }
        if (this.as.isNamespacedUser(sender)) {
            // Bridge is always valid.
            return true;
        }
        try {
            await JiraProjectConnection.assertUserHasAccessToProject(this.tokenStore, sender, connectionId.url);
            return true;
        } catch {
            return false;
        }
    }
}