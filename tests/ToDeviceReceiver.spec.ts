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
  HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
} from "../src/ToDeviceProtocol";
import { HookshotToDeviceReceiver } from "../src/ToDeviceReceiver";

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
): HookshotToDeviceReceiver {
  return new HookshotToDeviceReceiver(
    appservice as unknown as Appservice,
    new Map([["openproject", botUserId]]),
    options,
  );
}

describe("Hookshot to-device receiver", () => {
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
