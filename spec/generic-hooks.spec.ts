import { test as baseTest } from "./util/fixtures";
import { describe, expect, afterEach, vitest } from "vitest";
import { GenericHookConnection } from "../src/Connections";
import { add } from "date-fns/add";
import { createInboundConnection } from "./util/helpers";

const test = baseTest
  .override("enableWidgets", () => false)
  .override("listenerConfig", ({ webhooksPort }) => [
    {
      port: webhooksPort,
      bindAddress: "0.0.0.0",
      // Bind to the SAME listener to ensure we don't have conflicts.
      resources: ["webhooks"],
      // Test that custom prefixes work
      prefix: "/customprefix",
    },
  ])
  .override("testEnvOpts", ({ webhooksPort }) => ({
    config: {
      generic: {
        enabled: true,
        // Prefer to wait for complete as it reduces the concurrency of the test.
        waitForComplete: true,
        urlPrefix: `http://localhost:${webhooksPort}/customprefix/webhook`,
        payloadSizeLimit: "10mb",
      },
    },
  }));

describe("Inbound (Generic) Webhooks", () => {
  afterEach(() => {
    vitest.useRealTimers();
  });

  test("should be able to create a new webhook and handle an incoming request.", async ({
    testEnv,
    user,
  }) => {
    const roomId = await user.createRoom({ name: "My Test Webhooks room" });
    const okMsg = user.waitForRoomEvent({
      eventType: "m.room.message",
      sender: testEnv.botMxid,
      roomId,
    });
    const url = await createInboundConnection(user, testEnv.botMxid, roomId);
    expect((await okMsg).data.content.body).toEqual(
      "Room configured to bridge webhooks. See admin room for secret url.",
    );

    const expectedMsg = user.waitForRoomEvent({
      eventType: "m.room.message",
      sender: testEnv.botMxid,
      roomId,
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
  });

  test("should be able to create a new expiring webhook and handle valid requests.", async ({
    testEnv,
    user,
  }) => {
    vitest.useFakeTimers();
    const roomId = await user.createRoom({ name: "My Test Webhooks room" });
    const okMsg = user.waitForRoomEvent({
      eventType: "m.room.message",
      sender: testEnv.botMxid,
      roomId,
    });
    const url = await createInboundConnection(
      user,
      testEnv.botMxid,
      roomId,
      "2h",
    );
    expect((await okMsg).data.content.body).toEqual(
      "Room configured to bridge webhooks. See admin room for secret url.",
    );

    const expectedMsg = user.waitForRoomEvent({
      eventType: "m.room.message",
      sender: testEnv.botMxid,
      roomId,
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
    vitest.setSystemTime(add(new Date(), { hours: 3 }));
    const expiredReq = await fetch(url, {
      method: "PUT",
      body: "Hello world",
    });
    expect(expiredReq.status).toEqual(404);
    expect(await expiredReq.json()).toEqual({
      ok: false,
      error: "This hook has expired",
    });
  });

  test("should allow disabling hook data in matrix events.", async ({
    testEnv,
    user,
  }) => {
    const roomId = await user.createRoom({ name: "My Test Webhooks room" });
    const okMsg = user.waitForRoomEvent({
      eventType: "m.room.message",
      sender: testEnv.botMxid,
      roomId,
    });
    const url = await createInboundConnection(user, testEnv.botMxid, roomId);
    expect((await okMsg).data.content.body).toEqual(
      "Room configured to bridge webhooks. See admin room for secret url.",
    );

    await user.sendStateEvent(
      roomId,
      GenericHookConnection.CanonicalEventType,
      "test",
      {
        ...(await user.getRoomStateEvent(
          roomId,
          GenericHookConnection.CanonicalEventType,
          "test",
        )),
        includeHookBody: false,
      },
    );

    const expectedMsg = user.waitForRoomEvent({
      eventType: "m.room.message",
      sender: testEnv.botMxid,
      roomId,
    });
    const req = await fetch(url, {
      method: "PUT",
      body: "Hello world",
    });
    expect(req.status).toEqual(200);
    expect(await req.json()).toEqual({ ok: true });
    expect(
      (await expectedMsg).data.content["uk.half-shot.hookshot.webhook_data"],
    ).toBeUndefined();
  });

  test("should handle an incoming request with a larger body", async ({
    testEnv,
    user,
  }) => {
    const roomId = await user.createRoom({ name: "My Test Webhooks room" });
    const okMsg = user.waitForRoomEvent({
      eventType: "m.room.message",
      sender: testEnv.botMxid,
      roomId,
    });
    const url = await createInboundConnection(user, testEnv.botMxid, roomId);
    expect((await okMsg).data.content.body).toEqual(
      "Room configured to bridge webhooks. See admin room for secret url.",
    );

    const expectedMsg = user.waitForRoomEvent({
      eventType: "m.room.message",
      sender: testEnv.botMxid,
      roomId,
    });
    const body = Array.from({ length: 1024 * 1024 * 10 }).join("a");
    const req = await fetch(url, {
      method: "PUT",
      body: body,
    });
    expect(req.status).toEqual(200);
    expect(await req.json()).toEqual({ ok: true });
    const resultMsg = await expectedMsg;
    expect(resultMsg.data.content.body).toBeDefined();
    expect(resultMsg.data.content.formatted_body).toBeUndefined();
    expect(
      resultMsg.data.content["uk.half-shot.hookshot.webhook_data"],
    ).toBeUndefined();
  });
});
