import { Logger } from "matrix-appservice-bridge";
import { Intent, MatrixError } from "matrix-bot-sdk";

const GRANT_ACCOUNT_DATA_KEY = "uk.half-shot.matrix-hookshot.grant";

interface GrantContent {
    granted: boolean;
}

const log = new Logger("GrantChecker");

export class GrantRejectedError extends Error {
    constructor(roomId: string, connectionId: string) {
        super(`No grant exists for ${roomId}/${connectionId}. Rejecting`);
    }
}

export class GrantChecker {
    constructor(private readonly intent: Intent) { }

    private getKey(connectionId: string): string {
        return `${GRANT_ACCOUNT_DATA_KEY}/${connectionId}`.toLowerCase();
    }

    public async assertConnectionGranted(roomId: string, connectionId: string) {
        try {
            const content = await this.intent.underlyingClient.getRoomAccountData<GrantContent>(this.getKey(connectionId), roomId);
            if (!content.granted) {
                // Previously granted but now stale.
                throw new GrantRejectedError(roomId, connectionId);
            }
        } catch (ex) {
            if (ex instanceof MatrixError && ex.errcode === "M_NOT_FOUND") {
                throw new GrantRejectedError(roomId, connectionId);
            } else {
                log.warn(`Failed to check grant in ${roomId}/${connectionId}`, ex);
                throw new GrantRejectedError(roomId, connectionId);
            }
        }
    }

    public async grantConnection(roomId: string, connectionId: string) {
        await this.intent.underlyingClient.setRoomAccountData(
            this.getKey(connectionId),
            roomId,
            { granted: true } as GrantContent
        );
    }

    public async ungrantConnection(roomId: string, connectionId: string) {
        await this.intent.underlyingClient.setRoomAccountData(
            this.getKey(connectionId),
            roomId,
            { granted: false } as GrantContent
        );
    }
}