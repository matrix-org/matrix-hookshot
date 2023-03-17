import { Appservice } from "matrix-bot-sdk";
import { GitHubRepoConnection } from "../Connections";
import { GrantChecker } from "../grants/GrantCheck";
import { UserTokenStore } from "../UserTokenStore";
import { GithubInstance } from "./GithubInstance";

interface GitHubGrantConnectionId {
    org: string;
    repo: string;
}


export class GitHubGrantChecker extends GrantChecker<GitHubGrantConnectionId> {
    constructor(private readonly as: Appservice, private readonly github: GithubInstance, private readonly tokenStore: UserTokenStore) {
        super(as.botIntent, "github")
    }

    protected async checkFallback(roomId: string, connectionId: GitHubGrantConnectionId, sender?: string) {
        if (!sender) {
            // Cannot validate without a sender.
            return false;
        }
        if (this.as.isNamespacedUser(sender)) {
            // Bridge is always valid.
            return true;
        }
        try {
            await GitHubRepoConnection.assertUserHasAccessToRepo(sender, connectionId.org, connectionId.repo, this.github, this.tokenStore);
            return true;
        } catch (ex) {
            return false;
        }
    }
}