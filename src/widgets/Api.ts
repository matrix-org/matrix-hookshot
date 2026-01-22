import {
  Intent,
  MatrixError,
  MembershipEventContent,
  PLManager,
} from "matrix-bot-sdk";
import { ApiError, ErrCode } from "../api";
import { Logger } from "matrix-appservice-bridge";

export interface GetConnectionTypeResponseItem {
  eventType: string;
  type: string;
  service: string;
  botUserId: string;
}

export interface ConnectionWarning {
  header: string;
  message: string;
}

export interface GetConnectionsResponseItem<
  Config = object,
  Secrets = object,
> extends GetConnectionTypeResponseItem {
  id: string;
  config: Config;
  secrets?: Secrets;
  canSendMessages?: boolean;
  canEdit?: boolean;
  warning?: ConnectionWarning;
}

const log = new Logger("Provisioner.api");

export async function assertUserPermissionsInRoom(
  userId: string,
  roomId: string,
  requiredPermission: "read" | "write",
  intent: Intent,
) {
  // Always do an ensureJoined to clear any possible invites.
  await intent.ensureJoined(roomId);
  try {
    const membership = (await intent.underlyingClient.getRoomStateEvent(
      roomId,
      "m.room.member",
      intent.userId,
    )) as MembershipEventContent;
    if (membership.membership === "invite") {
      await intent.underlyingClient.joinRoom(roomId);
    } else if (membership.membership !== "join") {
      throw new ApiError("Bot is not joined to the room.", ErrCode.NotInRoom);
    }
  } catch (ex) {
    if (ex instanceof MatrixError && ex.errcode === "M_FORBIDDEN") {
      throw new ApiError(
        `User ${intent.userId} is not invited to the room.`,
        ErrCode.NotInRoom,
      );
    }
    if (ex instanceof MatrixError && ex.errcode === "M_NOT_FOUND") {
      throw new ApiError("User is not joined to the room.", ErrCode.NotInRoom);
    }
    log.warn(`Failed to find member event for ${userId} in room ${roomId}`, ex);
    throw new ApiError(
      `Could not determine if the user is in the room.`,
      ErrCode.NotInRoom,
    );
  }
  // If the user just wants to read, just ensure they are in the room.
  try {
    const membership = (await intent.underlyingClient.getRoomStateEvent(
      roomId,
      "m.room.member",
      userId,
    )) as MembershipEventContent;
    if (membership.membership !== "join") {
      throw new ApiError("User is not joined to the room.", ErrCode.NotInRoom);
    }
  } catch (ex) {
    if (ex instanceof MatrixError && ex.errcode === "M_NOT_FOUND") {
      throw new ApiError("User is not joined to the room.", ErrCode.NotInRoom);
    }
    log.warn(`Failed to find member event for ${userId} in room ${roomId}`, ex);
    throw new ApiError(
      `Could not determine if the user is in the room.`,
      ErrCode.NotInRoom,
    );
  }
  if (requiredPermission === "read") {
    return true;
  }
  let pls: PLManager;
  try {
    pls = new PLManager(
      await intent.underlyingClient.getRoomCreateEvent(roomId),
      await intent.underlyingClient.getRoomStateEventContent(
        roomId,
        "m.room.power_levels",
        "",
      ),
    );
  } catch (ex) {
    log.warn(`Failed to find PL event for room ${roomId}`, ex);
    throw new ApiError(
      `Could not get power levels for ${roomId}. Is the bot invited?`,
      ErrCode.NotInRoom,
    );
  }

  // TODO: Decide what PL consider "write" permissions
  const botPl = pls.getUserPowerLevel(intent.userId);
  const userPl = pls.getUserPowerLevel(userId);
  const requiredPl = pls.currentPL.state_default || 50;

  // Check the bot's permissions
  if (botPl < requiredPl) {
    throw new ApiError(
      `Bot has a PL of ${botPl} but needs at least ${requiredPl}.`,
      ErrCode.ForbiddenBot,
    );
  }

  // Now check the users
  if (userPl >= requiredPl) {
    return true;
  } else {
    throw new ApiError(
      `User has a PL of ${userPl} but needs at least ${requiredPl}.`,
      ErrCode.ForbiddenUser,
    );
  }
}
