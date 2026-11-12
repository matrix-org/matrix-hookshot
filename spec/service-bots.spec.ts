import { E2ESetupTestTimeout, E2ETestEnv } from "./util/e2e-test";
import { describe, test, beforeAll, afterAll, expect } from "vitest";
import { MatrixClient, TextualMessageEventContent } from "matrix-bot-sdk";
import { GenericHookConnection } from "../src/Connections";

describe("Service bots", () => {
  let testEnv: E2ETestEnv;
  let webhooksBotMxid: string;

  beforeAll(async () => {
    const webhooksPort = 9500 + E2ETestEnv.workerId;
    testEnv = await E2ETestEnv.createTestEnv({
      matrixLocalparts: ["user"],
      config: {
        generic: {
          enabled: true,
          waitForComplete: true,
          urlPrefix: `http://localhost:${webhooksPort}/webhook`,
        },
        serviceBots: [
          {
            localpart: "hookshot_webhooks",
            prefix: "!webhooks",
            service: "generic",
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
    webhooksBotMxid = `@hookshot_webhooks:${testEnv.homeserver.domain}`;
    await testEnv.setUp();
  }, E2ESetupTestTimeout);

  afterAll(() => {
    return testEnv?.tearDown();
  });

  test("should give a webhook created via the main bot to the webhooks service bot", async () => {
    const user = testEnv.getUser("user");
    const roomId = await user.createRoom({ name: "Service bots room" });
    for (const botMxid of [testEnv.botMxid, webhooksBotMxid]) {
      const join = user.waitForRoomJoin({ sender: botMxid, roomId });
      await user.inviteUser(botMxid, roomId);
      await user.setUserPowerLevel(botMxid, roomId, 50);
      await join;
    }
    const dmRoomId = await user.dms.getOrCreateDm(testEnv.botMxid);

    // The service bot should own the connection, even though the main bot handles the command.
    const connectionEvent = user.waitForRoomEvent({
      eventType: GenericHookConnection.CanonicalEventType,
      stateKey: "test",
      sender: webhooksBotMxid,
      roomId,
    });
    const urlMsg = user.waitForRoomEvent({
      sender: testEnv.botMxid,
      eventType: "m.room.message",
      roomId: dmRoomId,
    });
    await user.sendText(roomId, "!hookshot webhook test");

    await connectionEvent;

    // The hookId should be stored with the service bot that owns the connection.
    const webhooksBotClient = new MatrixClient(
      testEnv.homeserver.url,
      testEnv.homeserver.asToken,
    );
    webhooksBotClient.impersonateUserId(webhooksBotMxid);
    const accountData = await webhooksBotClient.getRoomAccountData<
      Record<string, string>
    >(GenericHookConnection.CanonicalEventType, roomId);
    const [hookId] = Object.entries(accountData).find(
      ([, stateKey]) => stateKey === "test",
    )!;

    const msgContent = (await urlMsg).data
      .content as unknown as TextualMessageEventContent;
    const url = msgContent.body.split("\n")[2];
    expect(url).toContain(hookId);

    // And the service bot should send the webhook messages.
    const webhookMsg = user.waitForRoomEvent({
      eventType: "m.room.message",
      sender: webhooksBotMxid,
      roomId,
    });
    const req = await fetch(url, { method: "PUT", body: "Hello world" });
    expect(req.status).toEqual(200);
    expect((await webhookMsg).data.content.body).toEqual(
      "Received webhook data: Hello world",
    );
  });
});
