import { Appservice } from "matrix-bot-sdk";
import { GitHubRepoConnection } from "../Connections";
import { GrantChecker } from "../grants/GrantCheck";
import { UserTokenStore } from "../tokens/UserTokenStore";
import { Logger } from 'matrix-appservice-bridge';

const log = new Logger('GitHubGrantChecker');

interface GitHubGrantConnectionId {
    org: string;
    repo: string;
}


export class GitHubGrantChecker extends GrantChecker<GitHubGrantConnectionId> {
    constructor(private readonly as: Appservice, private readonly tokenStore: UserTokenStore) {
        super(as.botIntent, "github")
    }

    protected async checkFallback(roomId: string, connectionId: GitHubGrantConnectionId, sender?: string) {
        if (!sender) {
            log.debug(`Tried to check fallback for ${roomId} with a missing sender`);
            // Cannot validate without a sender.
            return false;
        }
        if (this.as.isNamespacedUser(sender)) {
            // Bridge is always valid.
            return true;
        }
        try {
            await GitHubRepoConnection.assertUserHasAccessToRepo(sender, connectionId.org, connectionId.repo, this.tokenStore);
            return true;
        } catch (ex) {
            log.info(`Tried to check fallback for ${roomId}: ${sender} does not have access to ${connectionId.org}/${connectionId.repo}`, ex);
            return false;
        }
    }
}