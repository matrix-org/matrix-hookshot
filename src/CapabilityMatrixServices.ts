import { Appservice, PLManager } from "matrix-bot-sdk";
import { assertUserPermissionsInRoom } from "./widgets/Api";

/** Matrix checks shared by card capability probes, using the selected bot's view. */
export function createMatrixProbeServices(appservice: Appservice) {
  return {
    getAnchorEvent: (
      roomId: string,
      eventId: string,
      recipientBotUserId: string,
    ) =>
      appservice
        .getIntentForUserId(recipientBotUserId)
        .underlyingClient.getEvent(roomId, eventId),
    assertRoomReadAccess: async (
      userId: string,
      roomId: string,
      recipientBotUserId: string,
    ) => {
      await assertUserPermissionsInRoom(
        userId,
        roomId,
        "read",
        appservice.getIntentForUserId(recipientBotUserId),
      );
    },
    canSendRoomMessage: async (
      userId: string,
      roomId: string,
      recipientBotUserId: string,
    ) => {
      const client =
        appservice.getIntentForUserId(recipientBotUserId).underlyingClient;
      const powerLevels = new PLManager(
        await client.getRoomCreateEvent(roomId),
        await client.getRoomStateEventContent(
          roomId,
          "m.room.power_levels",
          "",
        ),
      );
      const requiredPowerLevel =
        powerLevels.currentPL.events?.["m.room.message"] ??
        powerLevels.currentPL.events_default ??
        0;
      return powerLevels.getUserPowerLevel(userId) >= requiredPowerLevel;
    },
  };
}
