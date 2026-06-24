import { test as baseTest } from "./util/fixtures";
import { describe, expect } from "vitest";
import { createInboundConnection, waitFor } from "./util/helpers";

const test = baseTest
  .override("enableWidgets", true)
  .override("testEnvOpts", ({ webhooksPort }) => ({
    config: {
      generic: {
        enabled: true,
        waitForComplete: true,
        urlPrefix: `http://localhost:${webhooksPort}`,
      },
    },
  }));

describe("Room Upgrades", () => {
  test(
    "should be able to create a new generic webhook, upgrade the room, and have the state carry over.",
    { timeout: 25000 },
    async ({ testEnv, user, bridgeApi }) => {
      const previousRoomId = await user.createRoom({
        name: "My Test Webhooks room",
      });
      const okMsg = user.waitForRoomEvent({
        eventType: "m.room.message",
        sender: testEnv.botMxid,
        roomId: previousRoomId,
      });
      const url = await createInboundConnection(
        user,
        testEnv.botMxid,
        previousRoomId,
      );
      expect((await okMsg).data.content.body).toEqual(
        "Room configured to bridge webhooks. See admin room for secret url.",
      );
      const newRoomId = await user.upgradeRoom(previousRoomId, "10");
      // NOTE: The room upgrade endpoint does NOT do invites, so we need to do this.
      await user.inviteUser(testEnv.botMxid, newRoomId);

      await user.waitForRoomJoin({
        sender: testEnv.botMxid,
        roomId: newRoomId,
      });

      // Wait for the state to carry over.
      await user.waitForRoomEvent({
        eventType: "uk.half-shot.matrix-hookshot.generic.hook",
        roomId: newRoomId,
        sender: testEnv.botMxid,
      });

      // Wait for hookshot to accept the new state.
      await waitFor(
        async () =>
          (await bridgeApi.getConnectionsForRoom(newRoomId)).length === 1,
      );

      const expectedMsg = user.waitForRoomEvent({
        eventType: "m.room.message",
        sender: testEnv.botMxid,
        roomId: newRoomId,
      });
      const req = await fetch(url, {
        method: "PUT",
        body: "Hello world",
      });
      expect(req.status).toEqual(200);
      expect(await req.json()).toEqual({ ok: true });
      expect((await expectedMsg).data.content).toEqual({
        msgtype: "m.notice",
        body: "Received webhook data: Hello world",
        formatted_body: "<p>Received webhook data: Hello world</p>",
        format: "org.matrix.custom.html",
        "uk.half-shot.hookshot.webhook_data": "Hello world",
      });

      // And finally ensure that the old room is no longer configured
      expect(
        await user.getRoomStateEventContent(
          previousRoomId,
          "uk.half-shot.matrix-hookshot.generic.hook",
          "test",
        ),
      ).toMatchObject({ disabled: true });
    },
  );
});
