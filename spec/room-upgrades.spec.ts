import { E2ESetupTestTimeout, E2ETestEnv } from "./util/e2e-test";
import { describe, test, beforeAll, afterAll, expect } from "vitest";
import { createInboundConnection, waitFor } from "./util/helpers";

describe("Room Upgrades", () => {
  let testEnv: E2ETestEnv;

  beforeAll(async () => {
    const webhooksPort = 9500 + E2ETestEnv.workerId;
    testEnv = await E2ETestEnv.createTestEnv({
      matrixLocalparts: ["user"],
      config: {
        generic: {
          enabled: true,
          // Prefer to wait for complete as it reduces the concurrency of the test.
          waitForComplete: true,
          urlPrefix: `http://localhost:${webhooksPort}`,
        },
        listeners: [
          {
            port: webhooksPort,
            bindAddress: "0.0.0.0",
            // Bind to the SAME listener to ensure we don't have conflicts.
            resources: ["webhooks"],
          },
        ],
      },
    });
    await testEnv.setUp();
  }, E2ESetupTestTimeout);

  afterAll(() => {
    return testEnv?.tearDown();
  });

  test.only(
    "should be able to create a new webhook, upgrade the room, and have the state carry over.",
    { timeout: 10000 },
    async () => {
      const user = testEnv.getUser("user");
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
