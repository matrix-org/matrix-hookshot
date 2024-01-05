import { Logger } from "matrix-appservice-bridge";
import { Appservice, Intent, MatrixError } from "matrix-bot-sdk";
import { BridgeConfig, BridgePermissionLevel } from "../config/Config";
import { FormatUtil } from "../FormatUtil";

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


type ConnectionId = string|object;

export class GrantChecker<cId extends ConnectionId = ConnectionId> {
    private static stringifyConnectionId<cId = ConnectionId>(connId: cId) {
        if (typeof connId === "string") {
            return FormatUtil.hashId(connId.toString());
        }
        return FormatUtil.hashId(Object.entries(connId as Record<string, unknown>).map((data) => `${data[0]}:${data[1]}`).join(''));
    }

    constructor(private readonly intent: Intent, protected readonly grantType: string) { }

    /**
     * If the connection hasn't been previously granted, we can use this function to check
     * their permissions in the moment.
     * 
     * By default, this always returns false.
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    protected checkFallback(_roomId: string, _connectionId: cId, _sender?: string): Promise<boolean>|boolean {
        return false;
    }

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
                if (!await this.checkFallback?.(roomId, connectionId, sender)) {
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

/**
 * Check the grant of a given connection, falling back to checking the permissions of the user
 * across the bridge.
 */
export class ConfigGrantChecker<cId extends ConnectionId = ConnectionId> extends GrantChecker<cId> {
    static ConfigMinAccessLevel = BridgePermissionLevel.admin;

    constructor(grantType: string, private readonly as: Appservice, private readonly config: BridgeConfig) {
        super(as.botIntent, grantType)
    }

    protected checkFallback(_roomId: string, _connectionId: cId, sender?: string) {
        if (!sender) {
            // Cannot validate without a sender.
            return false;
        }
        if (this.as.isNamespacedUser(sender)) {
            // Bridge is always valid.
            return true;
        }
        return this.config.checkPermission(sender, this.grantType, ConfigGrantChecker.ConfigMinAccessLevel);
    }
}