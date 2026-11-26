import { E2ESetupTestTimeout, E2ETestEnv } from "./util/e2e-test";
import { waitFor } from "./util/helpers";
import { describe, test, beforeAll, afterAll, expect } from "vitest";
import {
  GenericHookConnection,
  GenericHookConnectionState,
} from "../src/Connections";

describe("Statically configured connection in a room the bot has not joined", () => {
  let testEnv: E2ETestEnv;

  beforeAll(async () => {
    const webhooksPort = 9500 + E2ETestEnv.workerId;
    testEnv = await E2ETestEnv.createTestEnv({
      matrixLocalparts: ["user"],
      staticConnectionRooms: {
        // The bot is not in this room when hookshot starts.
        "room-invite": { members: [], createdBy: "user" },
      },
      config: {
        generic: {
          enabled: true,
          waitForComplete: true,
          urlPrefix: `http://localhost:${webhooksPort}`,
          payloadSizeLimit: "10mb",
        },
        connections: [
          {
            roomId: "room-invite",
            stateKey: "invite-later",
            connectionType: GenericHookConnection.CanonicalEventType,
            state: {
              name: "My hook",
            } satisfies GenericHookConnectionState,
          },
        ],
        listeners: [
          {
            port: webhooksPort,
            bindAddress: "0.0.0.0",
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

  test("activates a webhook once the bot is invited after startup", async () => {
    const user = testEnv.getUser("user");
    const roomId = testEnv.connectionRooms["room-invite"];
    const url = new URL(
      testEnv.opts.config?.generic?.urlPrefix! + "/webhook/invite-later",
    );

    // The bot is not in the room yet, so the connection is not active.
    const inactiveReq = await fetch(url, {
      method: "PUT",
      body: "Hello world",
    });
    expect(inactiveReq.status).toEqual(404);

    const join = user.waitForRoomJoin({ sender: testEnv.botMxid, roomId });
    await user.inviteUser(testEnv.botMxid, roomId);
    await join;

    const expectedMsg = user.waitForRoomEvent({
      eventType: "m.room.message",
      sender: testEnv.botMxid,
      roomId,
    });

    // Hookshot creates the connection after the join, without a restart.
    let req: Response | undefined;
    await waitFor(async () => {
      req = await fetch(url, {
        method: "PUT",
        body: "Hello world",
      });
      return req.status !== 404;
    });
    expect(req?.status).toEqual(200);
    expect(await req?.json()).toEqual({ ok: true });
    expect((await expectedMsg).data.content).toEqual({
      msgtype: "m.notice",
      body: "Received webhook data: Hello world",
      formatted_body: "<p>Received webhook data: Hello world</p>",
      format: "org.matrix.custom.html",
      "uk.half-shot.hookshot.webhook_data": "Hello world",
    });
  });
});
