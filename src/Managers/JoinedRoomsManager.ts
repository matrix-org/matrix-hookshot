export default class JoinedRoomsManager {
    // Map of room ID to set of our bot user IDs in the room
    private readonly _botsInRooms: Map<string, Set<string>> = new Map();

    /**
     * Gets a map of the bot users in each room.
     *
     * @returns Map of room IDs to the list of bot user IDs in that room.
     */
    get botsInRooms(): Map<string, string[]> {
        return new Map(Array.from(
            this._botsInRooms,
            ([k, v]) => [k, Array.from(v)]
        ));
    }

    /**
     * Gets the list of room IDs where at least one bot is a member.
     *
     * @returns List of room IDs.
     */
    get joinedRooms(): string[] {
        return Array.from(this._botsInRooms.keys());
    }

    /**
     * Adds a bot user ID to the set of bots in a room.
     *
     * @param roomId
     * @param botUserId
     */
    addJoinedRoom(roomId: string, botUserId: string) {
        const userIds = this._botsInRooms.get(roomId) ?? new Set<string>();
        userIds.add(botUserId);
        this._botsInRooms.set(roomId, userIds);
    }

    /**
     * Removes a bot user ID from the set of bots in a room.
     *
     * @param roomId
     * @param botUserId
     */
    removeJoinedRoom(roomId: string, botUserId: string) {
        const userIds = this._botsInRooms.get(roomId) ?? new Set<string>();
        userIds.delete(botUserId);
        if (userIds.size > 0) {
            this._botsInRooms.set(roomId, userIds);
        } else {
            this._botsInRooms.delete(roomId);
        }
    }

    /**
     * Gets the list of user IDs for all bots in a room.
     *
     * @param roomId
     * @returns List of user IDs for all bots in the room.
     */
    getBotsInRoom(roomId: string) {
        return Array.from(this._botsInRooms.get(roomId) || new Set<string>());
    }
}
