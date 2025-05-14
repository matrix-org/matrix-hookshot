import { Appservice } from "matrix-bot-sdk";
import { JiraProjectConnection } from "../Connections";
import { GrantChecker } from "../grants/GrantCheck";
import { UserTokenStore } from "../tokens/UserTokenStore";

interface OpenProjectGrantConnectionId {
  url: string;
}

export class OpenProjectGrantChecker extends GrantChecker<OpenProjectGrantConnectionId> {
  constructor(
    private readonly as: Appservice,
    private readonly tokenStore: UserTokenStore,
  ) {
    super(as.botIntent, "openproject");
  }

  protected async checkFallback(
    roomId: string,
    connectionId: OpenProjectGrantConnectionId,
    sender?: string,
  ) {
    if (!sender) {
      // Cannot validate without a sender.
      return false;
    }
    if (this.as.isNamespacedUser(sender)) {
      // Bridge is always valid.
      return true;
    }
    try {
      await JiraProjectConnection.assertUserHasAccessToProject(
        this.tokenStore,
        sender,
        connectionId.url,
      );
      return true;
    } catch {
      return false;
    }
  }
}
