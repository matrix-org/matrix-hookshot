import { Appservice, IAppserviceRegistration } from "matrix-bot-sdk";
import { Logger } from "matrix-appservice-bridge";

import { BridgeConfig } from "../Config/Config";
import JoinedRoomsManager from "./JoinedRoomsManager";

const log = new Logger("BotUsersManager");

export interface BotUser {
    localpart: string;
    userId: string;
    avatar?: string;
    displayname?: string;
    services: string[];
    prefix: string;
    // Bots with higher priority should handle a command first
    priority: number;
}

// Sort bot users by highest priority first.
const higherPriority: (a: BotUser, b: BotUser) => number = (a, b) => (a.priority < b.priority) ? 1 : -1;

export default class BotUsersManager {
    // Map of user ID to config for all our configured bot users
    private _botUsers = new Map<string, BotUser>();

    constructor(
        readonly config: BridgeConfig,
        readonly registration: IAppserviceRegistration,
        readonly as: Appservice,
        readonly joinedRoomsManager: JoinedRoomsManager,
    ) {
        // Default bot user
        this._botUsers.set(this.as.botUserId, {
            localpart: registration.sender_localpart,
            userId: this.as.botUserId,
            avatar: this.config.bot?.avatar,
            displayname: this.config.bot?.displayname,
            // Default bot can handle all services
            services: this.config.getEnabledServices(),
            prefix: "!hookshot",
            priority: 0,
        });

        // Service bot users
        if (this.config.serviceBots) {
            this.config.serviceBots.forEach(bot => {
                const userId = this.as.getUserId(bot.localpart);
                this._botUsers.set(userId, {
                    localpart: bot.localpart,
                    userId: userId,
                    avatar: bot.avatar,
                    displayname: bot.displayname,
                    services: bot.services,
                    prefix: bot.prefix,
                    // Service bots should handle commands first
                    priority: 1,
                });
            });
        }
    }

    /**
     * Gets the configured bot users, ordered by priority.
     *
     * @returns List of bot users.
     */
    get botUsers(): Readonly<BotUser>[] {
        return Array.from(this._botUsers.values())
            .sort(higherPriority)
    }

    /**
     * Gets a configured bot user by user ID.
     *
     * @param userId User ID to get.
     */
    getBotUser(userId: string): Readonly<BotUser> | undefined {
        return this._botUsers.get(userId);
    }

    /**
     * Checks if the given user ID belongs to a configured bot user.
     *
     * @param userId User ID to check.
     * @returns `true` if the user ID belongs to a bot user, otherwise `false`.
     */
    isBotUser(userId: string): boolean {
        return this._botUsers.has(userId);
    }

    /**
     * Gets all the bot users in a room, ordered by priority.
     *
     * @param roomId Room ID to get bots for.
     */
    getBotUsersInRoom(roomId: string): Readonly<BotUser>[] {
        return this.joinedRoomsManager.getBotsInRoom(roomId)
            .map(botUserId => this.getBotUser(botUserId))
            .filter((b): b is BotUser => b !== undefined)
            .sort(higherPriority);
    }

    /**
     * Gets a bot user in a room, optionally for a particular service.
     * When a service is specified, the bot user with the highest priority which handles that service is returned.
     *
     * @param roomId Room ID to get a bot user for.
     * @param serviceType Optional service type for the bot.
     */
    getBotUserInRoom(roomId: string, serviceType?: string): Readonly<BotUser> | undefined {
        const botUsersInRoom = this.getBotUsersInRoom(roomId);
        if (serviceType) {
            return botUsersInRoom.find(b => b.services.includes(serviceType));
        } else {
            return botUsersInRoom[0];
        }
    }

    /**
     * Gets the bot user with the highest priority for a particular service.
     *
     * @param serviceType Service type for the bot.
     */
    getBotUserForService(serviceType: string): Readonly<BotUser> | undefined {
        return this.botUsers.find(b => b.services.includes(serviceType));
    }
}
