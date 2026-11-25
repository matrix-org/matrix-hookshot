import { EventEmitter } from "events";
import type { Appservice, Intent } from "matrix-bot-sdk";
import { describe, expect, it, vi } from "vitest";

import { Bridge } from "../src/Bridge";
import {
  HOOKSHOT_CAPABILITIES_PROBE_EVENT_TYPE,
  HOOKSHOT_CAPABILITIES_PROBE_RESPONSE_EVENT_TYPE,
  HOOKSHOT_LOGIN_START_EVENT_TYPE,
  HOOKSHOT_LOGIN_START_RESPONSE_EVENT_TYPE,
  HOOKSHOT_LOGIN_STATUS_EVENT_TYPE,
  HOOKSHOT_LOGIN_STATUS_RESPONSE_EVENT_TYPE,
  HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
} from "../src/ToDeviceProtocol";

class FakeAppservice extends EventEmitter {
  public readonly sendToDevices = vi.fn();
  public readonly getEvent = vi.fn().mockRejectedValue({ statusCode: 404 });
  public readonly ensureToDeviceReady = vi.fn(
    async (userId: string) => `BOTSDK_DEVICE_${userId}`,
  );

  public readonly getIntentForUserId = vi.fn(
    (userId: string): Intent =>
      ({
        ensureToDeviceReady: () => this.ensureToDeviceReady(userId),
        underlyingClient: {
          getEvent: this.getEvent,
          sendToDevices: this.sendToDevices,
        },
      }) as unknown as Intent,
  );
}

function createBridge(
  appservice: FakeAppservice,
  botUsers: Array<{ userId: string; services: string[] }>,
): Bridge {
  return Object.assign(Object.create(Bridge.prototype), {
    as: appservice as unknown as Appservice,
    botUsersManager: {
      botUsers,
      getIntegrationBotForService: (service: string) =>
        botUsers.find((bot) => bot.services.includes(service)),
    },
    // Readiness must be called regardless of whether encryption is configured.
    config: { encryption: { storagePath: "/unused-in-unit-test" } },
  }) as Bridge;
}

describe("to-device receiver startup", () => {
  it("waits for each selected bot once before subscribing", async () => {
    const appservice = new FakeAppservice();
    const pendingReadiness = Promise.withResolvers<string>();
    appservice.ensureToDeviceReady.mockImplementationOnce(
      () => pendingReadiness.promise,
    );
    const bridge = createBridge(appservice, [
      { userId: "@openproject:example.org", services: ["openproject"] },
      {
        userId: "@hookshot:example.org",
        services: ["openproject", "generic", "github"],
      },
    ]);

    const startup = bridge["startToDeviceReceiver"]();
    expect(appservice.ensureToDeviceReady).toHaveBeenCalledWith(
      "@openproject:example.org",
    );
    expect(appservice.listenerCount("to-device")).toBe(0);

    pendingReadiness.resolve("BOTSDK_DEVICE");
    await startup;

    expect(
      appservice.getIntentForUserId.mock.calls.map(([userId]) => userId),
    ).toEqual(["@openproject:example.org", "@hookshot:example.org"]);
    expect(appservice.ensureToDeviceReady).toHaveBeenCalledTimes(2);
    expect(appservice.listenerCount("to-device")).toBe(1);
  });

  it("fails startup without subscribing or exposing the SDK error", async () => {
    const appservice = new FakeAppservice();
    appservice.ensureToDeviceReady.mockRejectedValueOnce(
      new Error("secret request details"),
    );
    const bridge = createBridge(appservice, [
      { userId: "@hookshot:example.org", services: ["generic"] },
    ]);

    const startupError = await bridge["startToDeviceReceiver"]().catch(
      (error: unknown) => error,
    );
    expect(startupError).toEqual(
      new Error(
        "Failed to prepare to-device receiver for @hookshot:example.org",
      ),
    );
    expect(String(startupError)).not.toContain("secret request details");
    expect(appservice.listenerCount("to-device")).toBe(0);
  });

  it("routes OpenProject probes and responds for services without a handler", async () => {
    const appservice = new FakeAppservice();
    const bridge = createBridge(appservice, [
      { userId: "@openproject:example.org", services: ["openproject"] },
      { userId: "@webhooks:example.org", services: ["generic"] },
    ]);
    await bridge["startToDeviceReceiver"]();

    for (const [integrationId, botUserId] of [
      ["openproject", "@openproject:example.org"],
      ["generic", "@webhooks:example.org"],
    ]) {
      await bridge["toDeviceReceiver"]!.handleToDeviceEvent({
        type: HOOKSHOT_CAPABILITIES_PROBE_EVENT_TYPE,
        sender: "@alice:example.org",
        to_user_id: botUserId,
        content: {
          v: HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
          request_id: integrationId,
          requesting_device_id: "ALICE_DEVICE",
          integration_id: integrationId,
          room_id: "!room:example.org",
          anchor_event_id: "$anchor",
        },
      });
    }

    expect(appservice.getEvent).toHaveBeenCalledOnce();
    expect(appservice.sendToDevices).toHaveBeenCalledTimes(2);
    expect(appservice.sendToDevices).toHaveBeenNthCalledWith(
      1,
      HOOKSHOT_CAPABILITIES_PROBE_RESPONSE_EVENT_TYPE,
      {
        "@alice:example.org": {
          ALICE_DEVICE: {
            v: HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
            request_id: "openproject",
            integration_id: "openproject",
            result: "not_authorized",
          },
        },
      },
    );
    expect(appservice.sendToDevices).toHaveBeenNthCalledWith(
      2,
      HOOKSHOT_CAPABILITIES_PROBE_RESPONSE_EVENT_TYPE,
      {
        "@alice:example.org": {
          ALICE_DEVICE: {
            v: HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
            request_id: "generic",
            integration_id: "generic",
            result: "unavailable",
          },
        },
      },
    );
  });

  it("wires OpenProject login-start and status handlers to their response event types", async () => {
    const appservice = new FakeAppservice();
    const bridge = createBridge(appservice, [
      { userId: "@openproject:example.org", services: ["openproject"] },
    ]);
    await bridge["startToDeviceReceiver"]();

    const requestBase = {
      v: HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
      requesting_device_id: "ALICE_DEVICE",
      integration_id: "openproject",
      room_id: "!room:example.org",
      anchor_event_id: "$anchor",
    };
    await bridge["toDeviceReceiver"]!.handleToDeviceEvent({
      type: HOOKSHOT_LOGIN_START_EVENT_TYPE,
      sender: "@alice:example.org",
      to_user_id: "@openproject:example.org",
      content: { ...requestBase, request_id: "login-start" },
    });
    await bridge["toDeviceReceiver"]!.handleToDeviceEvent({
      type: HOOKSHOT_LOGIN_STATUS_EVENT_TYPE,
      sender: "@alice:example.org",
      to_user_id: "@openproject:example.org",
      content: { ...requestBase, request_id: "login-status" },
    });

    expect(appservice.sendToDevices).toHaveBeenNthCalledWith(
      1,
      HOOKSHOT_LOGIN_START_RESPONSE_EVENT_TYPE,
      {
        "@alice:example.org": {
          ALICE_DEVICE: {
            v: HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
            request_id: "login-start",
            integration_id: "openproject",
            result: "not_authorized",
          },
        },
      },
    );
    expect(appservice.sendToDevices).toHaveBeenNthCalledWith(
      2,
      HOOKSHOT_LOGIN_STATUS_RESPONSE_EVENT_TYPE,
      {
        "@alice:example.org": {
          ALICE_DEVICE: {
            v: HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
            request_id: "login-status",
            integration_id: "openproject",
            result: "unavailable",
          },
        },
      },
    );
  });
});
