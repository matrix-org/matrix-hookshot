import { promises as fs } from "fs";
import axios from "axios";
import { Appservice, Intent } from "matrix-bot-sdk";
import { Logger } from "matrix-appservice-bridge";

import { BridgeConfig } from "../config/Config";

const mime = import('mime');
const log = new Logger("BotUsersManager");

export class BotUser {
    constructor(
        private readonly as: Appservice,
        readonly userId: string,
        readonly services: string[],
        readonly prefix: string,
        // Bots with higher priority should handle a command first
        readonly priority: number,
        readonly avatar?: string,
        readonly displayname?: string,
    ) {}

    get intent(): Intent {
        return this.as.getIntentForUserId(this.userId);
    }
}

// Sort bot users by highest priority first.
const higherPriority: (a: BotUser, b: BotUser) => number = (a, b) => (b.priority - a.priority);

export default class BotUsersManager {
    // Map of user ID to config for all our configured bot users
    private _botUsers = new Map<string, BotUser>();

    // Map of room ID to set of bot users in the room
    private _botsInRooms = new Map<string, Set<BotUser>>();

    constructor(
        readonly config: BridgeConfig,
        readonly as: Appservice,
    ) {
        // Default bot user
        this._botUsers.set(
            this.as.botUserId,
            new BotUser(
                this.as,
                this.as.botUserId,
                // Default bot can handle all services
                this.config.enabledServices,
                "!hookshot",
                0,
                this.config.bot?.avatar,
                this.config.bot?.displayname,
            )
        );

        // Service bot users
        if (this.config.serviceBots) {
            this.config.serviceBots.forEach(bot => {
                const botUserId = this.as.getUserId(bot.localpart);
                this._botUsers.set(
                    botUserId,
                    new BotUser(
                        this.as,
                        botUserId,
                        [bot.service],
                        bot.prefix,
                        // Service bots should handle commands first
                        1,
                        bot.avatar,
                        bot.displayname,
                    )
                );
            });
        }
    }

    async start(): Promise<void> {
        await this.ensureProfiles();
        await this.getJoinedRooms();
    }

    private async ensureProfiles(): Promise<void> {
        log.info("Ensuring bot users are set up...");
        for (const botUser of this.botUsers) {
            // Ensure the bot is registered
            log.debug(`Ensuring bot user ${botUser.userId} is registered`);
            await botUser.intent.ensureRegistered();

            await this.ensureProfile(botUser);
        }
    }

    /**
     * Ensures the bot user profile display name and avatar image are updated.
     *
     * @returns Promise resolving when the user profile has been ensured.
     */
    private async ensureProfile(botUser: BotUser): Promise<void> {
        log.debug(`Ensuring profile for ${botUser.userId} is updated`);

        let profile: {
            avatar_url?: string,
            displayname?: string,
        };
        try {
            profile = await botUser.intent.underlyingClient.getUserProfile(botUser.userId);
        } catch (e) {
            log.error(`Failed to get user profile for ${botUser.userId}:`, e);
            profile = {};
        }

        // Update display name if necessary
        if (botUser.displayname && profile.displayname !== botUser.displayname) {
            try {
                await botUser.intent.underlyingClient.setDisplayName(botUser.displayname);
                log.info(`Updated displayname for "${botUser.userId}" to ${botUser.displayname}`);
            } catch (e) {
                log.error(`Failed to set displayname for ${botUser.userId}:`, e);
            }
        }

        if (!botUser.avatar) {
            // Unset any avatar
            if (profile.avatar_url) {
                await botUser.intent.underlyingClient.setAvatarUrl('');
                log.info(`Removed avatar for "${botUser.userId}"`);
            }

            return;
        }

        if (botUser.avatar.startsWith("mxc://")) {
            // Configured avatar is a Matrix content URL
            if (profile.avatar_url === botUser.avatar) {
                // Avatar is current, no need to update
                log.debug(`Avatar for ${botUser.userId} is already updated`);
                return;
            }

            try {
                await botUser.intent.underlyingClient.setAvatarUrl(botUser.avatar);
                log.info(`Updated avatar for ${botUser.userId} to ${botUser.avatar}`);
            } catch (e) {
                log.error(`Failed to set avatar for ${botUser.userId}:`, e);
            }

            return;
        }

        // Otherwise assume configured avatar is a file path
        let avatarImage: {
            image: Buffer,
            contentType: string,
        };
        try {
            const contentType = (await mime).default.getType(botUser.avatar);
            if (!contentType) {
                throw new Error("Could not determine content type");
            }
            // File path
            avatarImage = {
                image: await fs.readFile(botUser.avatar),
                contentType,
            };
        } catch (e) {
            log.error(`Failed to load avatar at ${botUser.avatar}:`, e);
            return;
        }

        // Determine if an avatar update is needed
        if (profile.avatar_url) {
            try {
                const res = await axios.get(
                    botUser.intent.underlyingClient.mxcToHttp(profile.avatar_url),
                    { responseType: "arraybuffer" },
                );
                const currentAvatarImage = {
                    image: Buffer.from(res.data),
                    contentType: res.headers["content-type"],
                };
                if (
                    currentAvatarImage.image.equals(avatarImage.image)
                    && currentAvatarImage.contentType === avatarImage.contentType
                ) {
                    // Avatar is current, no need to update
                    log.debug(`Avatar for ${botUser.userId} is already updated`);
                    return;
                }
            } catch (e) {
                log.error(`Failed to get current avatar image for ${botUser.userId}:`, e);
            }
        }

        // Update the avatar
        try {
            const uploadedAvatarMxcUrl = await botUser.intent.underlyingClient.uploadContent(
                avatarImage.image,
                avatarImage.contentType,
            );
            await botUser.intent.underlyingClient.setAvatarUrl(uploadedAvatarMxcUrl);
            log.info(`Updated avatar for ${botUser.userId} to ${uploadedAvatarMxcUrl}`);
        } catch (e) {
            log.error(`Failed to set avatar for ${botUser.userId}:`, e);
        }
    }

    private async getJoinedRooms(): Promise<void> {
        log.info("Getting joined rooms...");
        for (const botUser of this.botUsers) {
            const joinedRooms = await botUser.intent.underlyingClient.getJoinedRooms();
            for (const roomId of joinedRooms) {
                this.onRoomJoin(botUser, roomId);
            }
        }
    }

    /**
     * Records a bot user having joined a room.
     *
     * @param botUser
     * @param roomId
     */
    onRoomJoin(botUser: BotUser, roomId: string): void {
        log.debug(`Bot user ${botUser.userId} joined room ${roomId}`);
        const botUsers = this._botsInRooms.get(roomId) ?? new Set<BotUser>();
        botUsers.add(botUser);
        this._botsInRooms.set(roomId, botUsers);
    }

    /**
     * Records a bot user having left a room.
     *
     * @param botUser
     * @param roomId
     */
    onRoomLeave(botUser: BotUser, roomId: string): void {
        log.info(`Bot user ${botUser.userId} left room ${roomId}`);
        const botUsers = this._botsInRooms.get(roomId) ?? new Set<BotUser>();
        botUsers.delete(botUser);
        if (botUsers.size > 0) {
            this._botsInRooms.set(roomId, botUsers);
        } else {
            this._botsInRooms.delete(roomId);
        }
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
     * Gets the configured bot users, ordered by priority.
     *
     * @returns List of bot users.
     */
    get botUsers(): BotUser[] {
        return Array.from(this._botUsers.values())
            .sort(higherPriority)
    }

    /**
     * Gets a configured bot user by user ID.
     *
     * @param userId User ID to get.
     */
    getBotUser(userId: string): BotUser | undefined {
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
    getBotUsersInRoom(roomId: string): BotUser[] {
        return Array.from(this._botsInRooms.get(roomId) || new Set<BotUser>())
            .sort(higherPriority);
    }

    /**
     * Gets a bot user in a room, optionally for a particular service.
     * When a service is specified, the bot user with the highest priority which handles that service is returned.
     *
     * @param roomId Room ID to get a bot user for.
     * @param serviceType Optional service type for the bot.
     */
    getBotUserInRoom(roomId: string, serviceType?: string): BotUser | undefined {
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
    getBotUserForService(serviceType: string): BotUser | undefined {
        return this.botUsers.find(b => b.services.includes(serviceType));
    }
}
