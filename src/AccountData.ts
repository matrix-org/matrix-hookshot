import { MatrixClient, MatrixError } from "matrix-bot-sdk";

export async function getSafeRoomAccountData<T,D>(client: MatrixClient, eventType: string, roomId: string, defaultContent: D): Promise<T|D> {
    try {
        return await client.getRoomAccountData<T>(eventType, roomId);
    } catch (ex) {
        if (ex instanceof MatrixError && ex.errcode === "M_NOT_FOUND") {
            return defaultContent;
        }
        throw ex;
    }
}