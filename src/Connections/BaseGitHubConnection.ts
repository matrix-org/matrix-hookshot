import { Appservice } from "matrix-bot-sdk";
import { ApiError, ErrCode } from "../api";
import { GrantChecker, GrantRejectedError } from "../GrantCheck";
import { UserTokenStore } from "../UserTokenStore";
import { Logger } from "matrix-appservice-bridge";
import { CommandConnection } from "./CommandConnection";
import { IConnectionState } from "./IConnection";
const log = new Logger("BaseGitHubConnection");

interface BaseGitHubState extends IConnectionState {
    org: string;
    repo: string;
}

export abstract class BaseGitHubConnection<StateType extends BaseGitHubState, ValidatedStateType extends BaseGitHubState = StateType> extends CommandConnection<StateType, ValidatedStateType>  {

    static async assertUserHasAccessToRepo(userId: string, org: string, repo: string, tokenStore: UserTokenStore) {
        const octokit = await tokenStore.getOctokitForUser(userId);
        if (!octokit) {
            throw new ApiError("User is not authenticated with GitHub", ErrCode.ForbiddenUser);
        }
        const me = await octokit.users.getAuthenticated();
        let permissionLevel;
        try {
            const githubRepo = await octokit.repos.getCollaboratorPermissionLevel({owner: org, repo, username: me.data.login });
            permissionLevel = githubRepo.data.permission;
        } catch (ex) {
            throw new ApiError("Could not determine if the user has access to this repository, does the repository exist?", ErrCode.ForbiddenUser);
        }

        if (permissionLevel !== "admin" && permissionLevel !== "write") {
            throw new ApiError("You must at least have write permissions to bridge this repository", ErrCode.ForbiddenUser);
        }
    }

    constructor(roomId: string, stateKey: string, canonicalStateType: string, protected state: StateType, protected tokenStore: UserTokenStore, private as: Appservice) {
        super(roomId, stateKey, canonicalStateType);
    }

    public get org() {
        return this.state.org.toLowerCase();
    }
    public get repo() {
        return this.state.repo.toLowerCase();
    }

    public async ensureGrant(sender?: string, state = this.state) {
        const grantChecker = new GrantChecker(this.as.botIntent);
        const grantKey = `${this.canonicalStateType}/${state.org}/${state.repo}`;
        try {
            await grantChecker.assertConnectionGranted(this.roomId, grantKey);
        } catch (ex) {
            if (ex instanceof GrantRejectedError) {
                log.warn(`No existing grant for ${state.org}/${state.repo}`);
                if (!sender) {
                    // TODO: Warn to the user.
                    throw Error('No grant for connection and no sender to check, cannot continue');
                }
                if (sender && !this.as.isNamespacedUser(sender)) {
                    // Sent by a third party user, so check they have access to the repo.
                    await BaseGitHubConnection.assertUserHasAccessToRepo(sender, state.org, state.repo, this.tokenStore);
                } else {
                    // This is one of our own bridged users, so realistically we probably authenticated
                    // this previously. Allow it.
                }
                // Try to rescue it.
                log.info(`Asserted that user does have access to repo, granting connection`);
                await grantChecker.grantConnection(this.roomId, grantKey);
            }
        }
    }
}