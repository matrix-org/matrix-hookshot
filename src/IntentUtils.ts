import { Logger } from "matrix-appservice-bridge";
import { Appservice, Intent, MatrixClient } from "matrix-bot-sdk";
import axios from "axios";

const log = new Logger("IntentUtils");

/**
 * Attempt to ensure that a given user is in a room, inviting them
 * via the bot user if nessacery.
 * 
 * If the bot user isn't in the room (and the target isn't in the room already),
 * this will fail.
 * @param targetIntent The intent for the user who should be in the room.
 * @param botClient The bot client for the room.
 * @param roomId The target room to invite to.
 * @throws If it was not possible to invite the user.
 */
export async function ensureUserIsInRoom(targetIntent: Intent, botClient: MatrixClient, roomId: string) {
    const senderUserId = targetIntent.userId;
    try {
        try {
            await targetIntent.ensureJoined(roomId);
        } catch (ex) {
            if ('errcode' in ex && ex.errcode === "M_FORBIDDEN") {
                // Make sure ghost user is invited to the room
                await botClient.inviteUser(senderUserId, roomId);
                await targetIntent.ensureJoined(roomId);
            } else {
                throw ex;
            }
        }
    } catch (ex) {
        log.warn(`Could not ensure that ${senderUserId} is in ${roomId}`, ex);
        throw Error(`Could not ensure that ${senderUserId} is in ${roomId}`);
    }
}

export async function getIntentForUser(user: {avatarUrl?: string, login: string}, as: Appservice, prefix?: string) {
    const domain = as.botUserId.split(":")[1];
    const intent = as.getIntentForUserId(`@${prefix ?? ''}${user.login}:${domain}`);
    const displayName = `${user.login}`;
    // Verify up-to-date profile
    let profile;
    await intent.ensureRegistered();
    try {
        profile = await intent.underlyingClient.getUserProfile(intent.userId);
    } catch (ex) {
        profile = {};
    }

    if (profile.displayname !== displayName) {
        log.debug(`Updating ${intent.userId}'s displayname`);
        if ((await intent.underlyingClient.getCapabilities())["m.set_displayname"]?.enabled !== false) {
            await intent.underlyingClient.setDisplayName(displayName);
        } else {
            log.debug(`NOT setting new displayname for ${intent.userId}, blocked by homeserver capabilities.`);
        }
    }

    if (!profile.avatar_url && user.avatarUrl) {
        log.debug(`Updating ${intent.userId}'s avatar`);
        const buffer = await axios.get(user.avatarUrl, {
            responseType: "arraybuffer",
        });
        log.info(`Uploading ${user.avatarUrl}`);
        // This does exist, but headers is silly and doesn't have content-type.
        // tslint:disable-next-line: no-any
        const contentType = buffer.headers["content-type"];
        const mxc = await intent.underlyingClient.uploadContent(
            Buffer.from(buffer.data as ArrayBuffer),
            contentType,
        );
        await intent.underlyingClient.setAvatarUrl(mxc);
    }

    return intent;
}