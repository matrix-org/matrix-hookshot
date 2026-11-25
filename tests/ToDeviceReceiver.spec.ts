import { EventEmitter } from "events";
import {
  Appservice,
  type IAppserviceToDeviceEvent,
  Intent,
} from "matrix-bot-sdk";
import { describe, expect, it, vi } from "vitest";

import {
  HOOKSHOT_CAPABILITIES_PROBE_EVENT_TYPE,
  HOOKSHOT_CAPABILITIES_PROBE_RESPONSE_EVENT_TYPE,
  HOOKSHOT_LOGIN_START_EVENT_TYPE,
  HOOKSHOT_LOGIN_START_RESPONSE_EVENT_TYPE,
  HOOKSHOT_LOGIN_STATUS_EVENT_TYPE,
  HOOKSHOT_LOGIN_STATUS_RESPONSE_EVENT_TYPE,
  HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
} from "../src/ToDeviceProtocol";
import {
  HookshotCapabilityEndpoint,
  HookshotToDeviceReceiver,
} from "../src/ToDeviceReceiver";

const sender = "@alice:example.org";
const botUserId = "@hookshot:example.org";

const validRequest = {
  v: HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
  request_id: "request-123",
  requesting_device_id: "ELEMENTDEVICE",
  integration_id: "openproject",
  room_id: "!room:example.org",
  anchor_event_id: "$anchor",
};

const validLoginStartRequest = {
  ...validRequest,
  request_id: "login-start-123",
};

const validLoginStatusRequest = {
  ...validRequest,
  request_id: "login-status-123",
};

class FakeAppservice extends EventEmitter {
  public readonly sendToDevices = vi.fn();
  public readonly intentUserIds: string[] = [];

  public getIntentForUserId(userId: string): Intent {
    this.intentUserIds.push(userId);
    return {
      underlyingClient: {
        sendToDevices: this.sendToDevices,
      },
    } as unknown as Intent;
  }
}

function makeEvent(
  content: unknown = validRequest,
  overrides: Partial<IAppserviceToDeviceEvent<unknown>> = {},
): IAppserviceToDeviceEvent<unknown> {
  return {
    type: HOOKSHOT_CAPABILITIES_PROBE_EVENT_TYPE,
    sender,
    to_user_id: botUserId,
    content,
    ...overrides,
  };
}

function createReceiver(
  appservice: FakeAppservice,
  options: ConstructorParameters<typeof HookshotToDeviceReceiver>[2] = {},
  integrations: ReadonlyMap<string, HookshotCapabilityEndpoint> = new Map([
    [
      "openproject",
      {
        botUserId,
        probeHandler: vi.fn().mockResolvedValue({ result: "unavailable" }),
      },
    ],
  ]),
): HookshotToDeviceReceiver {
  return new HookshotToDeviceReceiver(
    appservice as unknown as Appservice,
    integrations,
    options,
  );
}

describe("Hookshot to-device receiver", () => {
  it("routes login-start by integration and targets the requesting device", async () => {
    const appservice = new FakeAppservice();
    const openProjectLoginStart = vi.fn().mockResolvedValue({
      result: "ready",
      auth_url: "https://openproject.example.org/oauth/authorize?state=private",
    });
    const githubLoginStart = vi
      .fn()
      .mockResolvedValue({ result: "not_authorized" });
    const githubBotUserId = "@github:example.org";
    const receiver = createReceiver(
      appservice,
      {},
      new Map([
        [
          "openproject",
          {
            botUserId,
            probeHandler: vi.fn().mockResolvedValue({ result: "unavailable" }),
            loginStartHandler: openProjectLoginStart,
          },
        ],
        [
          "github",
          {
            botUserId: githubBotUserId,
            probeHandler: vi.fn().mockResolvedValue({ result: "unavailable" }),
            loginStartHandler: githubLoginStart,
          },
        ],
      ]),
    );

    await receiver.handleToDeviceEvent(
      makeEvent(validLoginStartRequest, {
        type: HOOKSHOT_LOGIN_START_EVENT_TYPE,
      }),
    );
    await receiver.handleToDeviceEvent(
      makeEvent(
        {
          ...validLoginStartRequest,
          request_id: "github-login-start",
          integration_id: "github",
        },
        { type: HOOKSHOT_LOGIN_START_EVENT_TYPE, to_user_id: githubBotUserId },
      ),
    );

    expect(openProjectLoginStart).toHaveBeenCalledWith(validLoginStartRequest, {
      sender,
      recipientBotUserId: botUserId,
    });
    expect(githubLoginStart).toHaveBeenCalledOnce();
    expect(appservice.sendToDevices).toHaveBeenNthCalledWith(
      1,
      HOOKSHOT_LOGIN_START_RESPONSE_EVENT_TYPE,
      {
        [sender]: {
          ELEMENTDEVICE: {
            v: HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
            request_id: validLoginStartRequest.request_id,
            integration_id: "openproject",
            result: "ready",
            auth_url:
              "https://openproject.example.org/oauth/authorize?state=private",
          },
        },
      },
    );
    expect(appservice.sendToDevices).toHaveBeenNthCalledWith(
      2,
      HOOKSHOT_LOGIN_START_RESPONSE_EVENT_TYPE,
      {
        [sender]: {
          ELEMENTDEVICE: {
            v: HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
            request_id: "github-login-start",
            integration_id: "github",
            result: "not_authorized",
          },
        },
      },
    );
  });

  it("routes connection-status requests and returns only the correlated status", async () => {
    const appservice = new FakeAppservice();
    const loginStatusHandler = vi
      .fn()
      .mockResolvedValue({ result: "connected" });
    const receiver = createReceiver(
      appservice,
      {},
      new Map([
        [
          "openproject",
          {
            botUserId,
            probeHandler: vi.fn().mockResolvedValue({ result: "unavailable" }),
            loginStatusHandler,
          },
        ],
      ]),
    );

    await receiver.handleToDeviceEvent(
      makeEvent(validLoginStatusRequest, {
        type: HOOKSHOT_LOGIN_STATUS_EVENT_TYPE,
      }),
    );

    expect(loginStatusHandler).toHaveBeenCalledOnce();
    expect(appservice.sendToDevices).toHaveBeenCalledWith(
      HOOKSHOT_LOGIN_STATUS_RESPONSE_EVENT_TYPE,
      {
        [sender]: {
          ELEMENTDEVICE: {
            v: HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
            request_id: validLoginStatusRequest.request_id,
            integration_id: "openproject",
            result: "connected",
          },
        },
      },
    );
  });

  it("returns unavailable when an integration has no login handler", async () => {
    const appservice = new FakeAppservice();
    const receiver = createReceiver(appservice);

    await receiver.handleToDeviceEvent(
      makeEvent(validLoginStartRequest, {
        type: HOOKSHOT_LOGIN_START_EVENT_TYPE,
      }),
    );
    await receiver.handleToDeviceEvent(
      makeEvent(validLoginStatusRequest, {
        type: HOOKSHOT_LOGIN_STATUS_EVENT_TYPE,
      }),
    );

    expect(appservice.sendToDevices).toHaveBeenNthCalledWith(
      1,
      HOOKSHOT_LOGIN_START_RESPONSE_EVENT_TYPE,
      {
        [sender]: {
          ELEMENTDEVICE: {
            v: HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
            request_id: validLoginStartRequest.request_id,
            integration_id: "openproject",
            result: "unavailable",
          },
        },
      },
    );
    expect(appservice.sendToDevices).toHaveBeenNthCalledWith(
      2,
      HOOKSHOT_LOGIN_STATUS_RESPONSE_EVENT_TYPE,
      {
        [sender]: {
          ELEMENTDEVICE: {
            v: HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
            request_id: validLoginStatusRequest.request_id,
            integration_id: "openproject",
            result: "unavailable",
          },
        },
      },
    );
  });

  it("ignores login requests with invalid content, unknown integrations, or the wrong bot", async () => {
    const appservice = new FakeAppservice();
    const loginStartHandler = vi
      .fn()
      .mockResolvedValue({ result: "unavailable" });
    const receiver = createReceiver(
      appservice,
      {},
      new Map([
        [
          "openproject",
          {
            botUserId,
            probeHandler: vi.fn().mockResolvedValue({ result: "unavailable" }),
            loginStartHandler,
          },
        ],
      ]),
    );

    await receiver.handleToDeviceEvent(
      makeEvent(
        { ...validLoginStartRequest, user_id: sender },
        { type: HOOKSHOT_LOGIN_START_EVENT_TYPE },
      ),
    );
    await receiver.handleToDeviceEvent(
      makeEvent(
        { ...validLoginStartRequest, integration_id: "github" },
        { type: HOOKSHOT_LOGIN_START_EVENT_TYPE },
      ),
    );
    await receiver.handleToDeviceEvent(
      makeEvent(validLoginStartRequest, {
        type: HOOKSHOT_LOGIN_START_EVENT_TYPE,
        to_user_id: "@other:example.org",
      }),
    );

    expect(loginStartHandler).not.toHaveBeenCalled();
    expect(appservice.sendToDevices).not.toHaveBeenCalled();
  });

  it("does not send a response or retry a failed handler within the deduplication window", async () => {
    const appservice = new FakeAppservice();
    const loginStartHandler = vi.fn().mockRejectedValue(new Error("failure"));
    const receiver = createReceiver(
      appservice,
      {},
      new Map([
        [
          "openproject",
          {
            botUserId,
            probeHandler: vi.fn().mockResolvedValue({ result: "unavailable" }),
            loginStartHandler,
          },
        ],
      ]),
    );

    await expect(
      receiver.handleToDeviceEvent(
        makeEvent(validLoginStartRequest, {
          type: HOOKSHOT_LOGIN_START_EVENT_TYPE,
        }),
      ),
    ).rejects.toThrow("failure");
    await receiver.handleToDeviceEvent(
      makeEvent(validLoginStartRequest, {
        type: HOOKSHOT_LOGIN_START_EVENT_TYPE,
      }),
    );

    expect(loginStartHandler).toHaveBeenCalledOnce();
    expect(appservice.sendToDevices).not.toHaveBeenCalled();
  });

  it("sends a targeted transport response for a valid probe", async () => {
    const appservice = new FakeAppservice();
    const receiver = createReceiver(appservice);

    await receiver.handleToDeviceEvent(makeEvent());

    expect(appservice.intentUserIds).toEqual([botUserId]);
    expect(appservice.sendToDevices).toHaveBeenCalledOnce();
    expect(appservice.sendToDevices).toHaveBeenCalledWith(
      HOOKSHOT_CAPABILITIES_PROBE_RESPONSE_EVENT_TYPE,
      {
        [sender]: {
          ELEMENTDEVICE: {
            v: HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
            request_id: validRequest.request_id,
            integration_id: validRequest.integration_id,
            result: "unavailable",
          },
        },
      },
    );
  });

  it("delivers capability actions to only the requesting device", async () => {
    const appservice = new FakeAppservice();
    const receiver = createReceiver(
      appservice,
      {},
      new Map([
        [
          "openproject",
          {
            botUserId,
            probeHandler: vi.fn().mockResolvedValue({
              result: "ok",
              connection: "connected",
              actions: [
                {
                  id: "assign_self",
                  label: "Assign to me",
                  command: "!openproject project assign 17",
                },
              ],
            }),
          },
        ],
      ]),
    );

    await receiver.handleToDeviceEvent(makeEvent());

    expect(appservice.sendToDevices).toHaveBeenCalledWith(
      HOOKSHOT_CAPABILITIES_PROBE_RESPONSE_EVENT_TYPE,
      {
        [sender]: {
          ELEMENTDEVICE: {
            v: HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
            request_id: validRequest.request_id,
            integration_id: validRequest.integration_id,
            result: "ok",
            connection: "connected",
            actions: [
              {
                id: "assign_self",
                label: "Assign to me",
                command: "!openproject project assign 17",
              },
            ],
          },
        },
      },
    );
  });

  it("dispatches only to the registered integration and its selected bot", async () => {
    const appservice = new FakeAppservice();
    const openProjectHandler = vi.fn().mockResolvedValue({ result: "ok" });
    const githubHandler = vi
      .fn()
      .mockResolvedValue({ result: "not_connected" });
    const githubBotUserId = "@github:example.org";
    const receiver = createReceiver(
      appservice,
      {},
      new Map([
        ["openproject", { botUserId, probeHandler: openProjectHandler }],
        ["github", { botUserId: githubBotUserId, probeHandler: githubHandler }],
      ]),
    );

    await receiver.handleToDeviceEvent(makeEvent());
    await receiver.handleToDeviceEvent(
      makeEvent(
        {
          ...validRequest,
          integration_id: "github",
          request_id: "github-request",
        },
        { to_user_id: githubBotUserId },
      ),
    );
    await receiver.handleToDeviceEvent(
      makeEvent({
        ...validRequest,
        integration_id: "github",
        request_id: "wrong-bot",
      }),
    );

    expect(openProjectHandler).toHaveBeenCalledOnce();
    expect(githubHandler).toHaveBeenCalledOnce();
    expect(githubHandler).toHaveBeenCalledWith(
      expect.objectContaining({ integration_id: "github" }),
      { sender, recipientBotUserId: githubBotUserId },
    );
    expect(appservice.sendToDevices).toHaveBeenCalledTimes(2);
  });

  it("subscribes only to appservice to-device events and unsubscribes", async () => {
    const appservice = new FakeAppservice();
    const receiver = createReceiver(appservice);

    receiver.start();
    appservice.emit("ephemeral.event", makeEvent());
    await Promise.resolve();
    expect(appservice.sendToDevices).not.toHaveBeenCalled();

    appservice.emit("to-device", makeEvent());
    await vi.waitFor(() => expect(appservice.sendToDevices).toHaveBeenCalled());

    receiver.stop();
    appservice.sendToDevices.mockClear();
    appservice.emit(
      "to-device",
      makeEvent({ ...validRequest, request_id: "request-456" }),
    );
    await Promise.resolve();
    expect(appservice.sendToDevices).not.toHaveBeenCalled();
  });

  it.each([
    [
      "a response event",
      { type: HOOKSHOT_CAPABILITIES_PROBE_RESPONSE_EVENT_TYPE },
    ],
    ["an event for another bot", { to_user_id: "@other-bot:example.org" }],
    [
      "an unknown integration",
      { content: { ...validRequest, integration_id: "github" } },
    ],
    ["an invalid sender", { sender: "alice" }],
    [
      "an invalid request",
      { content: { ...validRequest, requesting_device_id: "*" } },
    ],
  ])("ignores %s", async (_description, overrides) => {
    const appservice = new FakeAppservice();
    const receiver = createReceiver(appservice);

    await receiver.handleToDeviceEvent(makeEvent(undefined, overrides));

    expect(appservice.sendToDevices).not.toHaveBeenCalled();
  });

  it("deduplicates by sender, integration, and request ID until the TTL expires", async () => {
    const appservice = new FakeAppservice();
    let now = 1000;
    const receiver = createReceiver(appservice, {
      deduplicationTtlMs: 100,
      now: () => now,
    });

    await receiver.handleToDeviceEvent(makeEvent());
    await receiver.handleToDeviceEvent(makeEvent());
    expect(appservice.sendToDevices).toHaveBeenCalledOnce();

    now = 1100;
    await receiver.handleToDeviceEvent(makeEvent());
    expect(appservice.sendToDevices).toHaveBeenCalledTimes(2);
  });

  it("bounds the deduplication cache", async () => {
    const appservice = new FakeAppservice();
    const receiver = createReceiver(appservice, {
      maxDeduplicationEntries: 1,
    });

    await receiver.handleToDeviceEvent(makeEvent(validRequest));
    await receiver.handleToDeviceEvent(
      makeEvent({ ...validRequest, request_id: "request-456" }),
    );
    await receiver.handleToDeviceEvent(makeEvent(validRequest));

    expect(appservice.sendToDevices).toHaveBeenCalledTimes(3);
  });
});
