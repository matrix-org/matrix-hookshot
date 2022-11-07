import { Appservice, IAppserviceRegistration } from "matrix-bot-sdk";

import { BridgeConfig } from "../Config/Config";

export interface BotUser {
    localpart: string;
    userId: string;
    avatar?: string;
    displayname?: string;
    prefix: string;
}

export default class BotUsersManager {
    // Map of user ID to config for all our configured bot users
    private _botUsers = new Map<string, BotUser>();

    constructor(
        readonly config: BridgeConfig,
        readonly registration: IAppserviceRegistration,
        readonly as: Appservice,
    ) {
        // Default bot user
        this._botUsers.set(this.as.botUserId, {
            localpart: registration.sender_localpart,
            userId: this.as.botUserId,
            avatar: this.config.bot?.avatar,
            displayname: this.config.bot?.displayname,
            prefix: "!hookshot",
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
                    prefix: bot.prefix,
                });
            });
        }
    }

    /**
     * Gets the configured bot users.
     *
     * @returns List of bot users.
     */
    get botUsers(): Readonly<BotUser>[] {
        return Array.from(this._botUsers.values());
    }

    /**
     * Gets the configured bot user IDs.
     *
     * @returns List of bot user IDs.
     */
    get botUserIds(): string[] {
        return Array.from(this._botUsers.keys());
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
}
