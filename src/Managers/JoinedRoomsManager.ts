export default class JoinedRoomsManager {
    // Map of room ID to set of our bot user IDs in the room
    private readonly botsInRooms: Map<string, Set<string>> = new Map();

    /**
     * Get the list of room IDs where at least one bot is a member.
     * @returns List of room IDs.
     */
    getJoinedRooms(): string[] {
        return Array.from(this.botsInRooms.keys());
    }

    /**
     * Add a bot user ID to the set of bots in a room.
     * @param roomId
     * @param botUserId
     */
    addJoinedRoom(roomId: string, botUserId: string) {
        const userIds = this.botsInRooms.get(roomId) ?? new Set<string>();
        userIds.add(botUserId);
        this.botsInRooms.set(roomId, userIds);
    }

    /**
     * Remove a bot user ID from the set of bots in a room.
     * @param roomId
     * @param botUserId
     */
    removeJoinedRoom(roomId: string, botUserId: string) {
        const userIds = this.botsInRooms.get(roomId) ?? new Set<string>();
        userIds.delete(botUserId);
        if (userIds.size > 0) {
            this.botsInRooms.set(roomId, userIds);
        } else {
            this.botsInRooms.delete(roomId);
        }
    }

    /**
     * Get the list of user IDs for all bots in a room.
     * @param roomId
     * @returns List of user IDs for all bots in the room.
     */
    getBotsInRoom(roomId: string) {
        return Array.from(this.botsInRooms.get(roomId) || new Set<string>());
    }
}
