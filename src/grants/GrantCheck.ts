import { Logger } from "matrix-appservice-bridge";
import { Appservice, Intent, MatrixError } from "matrix-bot-sdk";
import { BridgeConfig, BridgeConfigGitLab, BridgePermissionLevel } from "../Config/Config";
import { GitHubRepoConnection, GitLabRepoConnection } from "../Connections";
import { FormatUtil } from "../FormatUtil";
import { GithubInstance } from "../Github/GithubInstance";
import { UserTokenStore } from "../UserTokenStore";

const GRANT_ACCOUNT_DATA_KEY = "uk.half-shot.matrix-hookshot.grant";

interface GrantContent {
    granted: boolean;
}

const log = new Logger("GrantChecker");

export class GrantRejectedError extends Error {
    constructor(public readonly roomId: string, public readonly connectionId: string) {
        super(`No grant exists for ${roomId}/${connectionId}. Rejecting`);
    }
}

interface GitHubGrantConnectionId {
    org: string;
    repo: string;
}

interface GitLabGrantConnectionId{
    instance: string;
    path: string;
}

type ConnectionId = NonNullable<string|object>;

/**
 * If the connection hasn't been previously granted, we can use this function to check
 * their permissions in the moment.
 */
type GrantFallbackFn<cId extends ConnectionId> = (roomId: string, connectionId: cId, sender?: string) => Promise<boolean>|boolean;

export class GrantChecker<cId extends ConnectionId = ConnectionId> {

    static ConfigMinAccessLevel = BridgePermissionLevel.admin;

    /**
     * Check the permissions of the sender, in case of a missing grant.
     * @param as The appservice.
     * @param config The bridge config.
     * @param service The service name e.g. "github"
     * @returns A GrantChecker
     */
    static withConfigFallback(as: Appservice, config: BridgeConfig, service: string) {
        return new GrantChecker(as.botIntent, service, (_roomId, _connId, sender) => {
            if (!sender) {
                // Cannot validate without a sender.
                return false;
            }
            if (as.isNamespacedUser(sender)) {
                // Bridge is always valid.
                return true;
            }
            return config.checkPermission(sender, service, this.ConfigMinAccessLevel);
        })
    }

    /**
     * Check the permissions on GitHub, in case of a missing grant.
     * @param as The appservice.
     * @param config The bridge config.
     * @param service The service name e.g. "github"
     * @returns A GrantChecker
     */
    static withGitHubFallback(as: Appservice, github: GithubInstance, tokenStore: UserTokenStore) {
        return new GrantChecker<GitHubGrantConnectionId>(as.botIntent, "github", async (_roomId, connId, sender) => {
            if (!sender) {
                // Cannot validate without a sender.
                return false;
            }
            if (as.isNamespacedUser(sender)) {
                // Bridge is always valid.
                return true;
            }
            try {
                await GitHubRepoConnection.assertUserHasAccessToRepo(sender, connId.org, connId.repo, github, tokenStore);
                return true;
            } catch (ex) {
                return false;
            }
        });
    }

    /**
     * Check the permissions on GitLab, in case of a missing grant.
     * @param as 
     * @param config 
     * @param tokenStore 
     * @returns 
     */
    static withGitLabFallback(as: Appservice, config: BridgeConfigGitLab, tokenStore: UserTokenStore) {
        return new GrantChecker<GitLabGrantConnectionId>(as.botIntent, "gitlab", async (_roomId, connId, sender) => {
            if (!sender) {
                // Cannot validate without a sender.
                return false;
            }
            if (as.isNamespacedUser(sender)) {
                // Bridge is always valid.
                return true;
            }
            try {
                await GitLabRepoConnection.assertUserHasAccessToProject(connId.instance, connId.path, sender, tokenStore, config);
                return true;
            } catch (ex) {
                return false;
            }
        });
    }

    private static stringifyConnectionId<cId = ConnectionId>(connId: cId) {
        if (typeof connId === "string") {
            return FormatUtil.hashId(connId.toString());
        }
        if (Array.isArray(connId)) {
            throw Error('Array types are invalid');
        }
        return FormatUtil.hashId(Object.entries(connId as Record<string, unknown>).map((data) => `${data[0]}:${data[1]}`).join(''));
    }

    constructor(private readonly intent: Intent, private readonly grantType: string, private readonly grantFallbackFn?: GrantFallbackFn<cId>) { }

    private getKey(connectionIdStr: string): string {
        return `${GRANT_ACCOUNT_DATA_KEY}/${this.grantType}/${connectionIdStr}`.toLowerCase();
    }

    public async assertConnectionGranted(roomId: string, connectionId: cId, sender?: string) {
        const connId = GrantChecker.stringifyConnectionId(connectionId);
        try {
            const content = await this.intent.underlyingClient.getRoomAccountData<GrantContent>(this.getKey(connId), roomId);
            if (!content.granted) {
                // Previously granted but now stale.
                throw new GrantRejectedError(roomId, connId);
            }
        } catch (ex) {
            if (ex instanceof MatrixError && ex.errcode === "M_NOT_FOUND") {
                if (!await this.grantFallbackFn?.(roomId, connectionId, sender)) {
                    throw new GrantRejectedError(roomId, connId);
                } else {
                    log.info(`Grant fallback succeeded for ${roomId}/${connectionId}`);
                    await this.grantConnection(roomId, connectionId);
                }
            } else {
                log.warn(`Failed to check grant in ${roomId}/${connectionId}`, ex);
                throw new GrantRejectedError(roomId, connId);
            }
        }
    }

    public async grantConnection(roomId: string, connectionId: cId) {
        const cidStr = GrantChecker.stringifyConnectionId(connectionId);
        log.info(`Granting ${roomId}/${cidStr}`);
        await this.intent.underlyingClient.setRoomAccountData(
            this.getKey(cidStr),
            roomId,
            { granted: true } as GrantContent
        );
    }

    public async ungrantConnection(roomId: string, connectionId: cId) {
        const cidStr = GrantChecker.stringifyConnectionId(connectionId);
        log.info(`Ungranting ${roomId}/${cidStr}`);
        await this.intent.underlyingClient.setRoomAccountData(
            this.getKey(cidStr),
            roomId,
            { granted: false } as GrantContent
        );
    }
}