import { Appservice } from "matrix-bot-sdk";
import { describe, expect, it, vi } from "vitest";

import {
  HOOKSHOT_TO_DEVICE_RECEIVER_DEVICE_ID,
  provisionToDeviceReceiverDevices,
} from "../src/ToDeviceDeviceProvisioner";

type FakeIntent = {
  ensureRegistered: ReturnType<typeof vi.fn>;
  underlyingClient: {
    doRequest: ReturnType<typeof vi.fn>;
    getOwnDevices: ReturnType<typeof vi.fn>;
  };
};

function createFakeAppservice(
  devices: Array<{ device_id: string }> = [
    { device_id: HOOKSHOT_TO_DEVICE_RECEIVER_DEVICE_ID },
  ],
  doRequest = vi.fn().mockResolvedValue({}),
) {
  const intents = new Map<string, FakeIntent>();
  const getIntentForUserId = vi.fn((userId: string) => {
    let intent = intents.get(userId);
    if (!intent) {
      intent = {
        ensureRegistered: vi.fn().mockResolvedValue(undefined),
        underlyingClient: {
          doRequest,
          getOwnDevices: vi.fn().mockResolvedValue(devices),
        },
      };
      intents.set(userId, intent);
    }
    return intent;
  });

  return {
    appservice: { getIntentForUserId } as unknown as Appservice,
    getIntentForUserId,
  };
}

describe("to-device receiver device provisioning", () => {
  it("creates and verifies one deterministic device per capability bot", async () => {
    const { appservice, getIntentForUserId } = createFakeAppservice();

    await provisionToDeviceReceiverDevices(
      appservice,
      ["@hookshot:example.org", "@hookshot:example.org"],
      false,
    );

    const intent = getIntentForUserId.mock.results[0]?.value as FakeIntent;
    expect(getIntentForUserId).toHaveBeenCalledOnce();
    expect(intent.ensureRegistered).toHaveBeenCalledOnce();
    expect(intent.underlyingClient.doRequest).toHaveBeenCalledWith(
      "PUT",
      `/_matrix/client/v3/devices/${HOOKSHOT_TO_DEVICE_RECEIVER_DEVICE_ID}`,
      null,
      {},
    );
    expect(intent.underlyingClient.getOwnDevices).toHaveBeenCalledOnce();
  });

  it("reuses the same device ID on subsequent startups", async () => {
    const { appservice, getIntentForUserId } = createFakeAppservice();

    await provisionToDeviceReceiverDevices(
      appservice,
      ["@hookshot:example.org"],
      false,
    );
    await provisionToDeviceReceiverDevices(
      appservice,
      ["@hookshot:example.org"],
      false,
    );

    const intent = getIntentForUserId.mock.results[0]?.value as FakeIntent;
    expect(getIntentForUserId).toHaveBeenCalledTimes(2);
    expect(getIntentForUserId.mock.results[1]?.value).toBe(intent);
    expect(intent.underlyingClient.doRequest).toHaveBeenCalledTimes(2);
    expect(intent.underlyingClient.doRequest).toHaveBeenNthCalledWith(
      1,
      "PUT",
      `/_matrix/client/v3/devices/${HOOKSHOT_TO_DEVICE_RECEIVER_DEVICE_ID}`,
      null,
      {},
    );
    expect(intent.underlyingClient.doRequest).toHaveBeenNthCalledWith(
      2,
      "PUT",
      `/_matrix/client/v3/devices/${HOOKSHOT_TO_DEVICE_RECEIVER_DEVICE_ID}`,
      null,
      {},
    );
  });

  it("does not provision a dedicated device when encryption is enabled", async () => {
    const { appservice, getIntentForUserId } = createFakeAppservice();

    await provisionToDeviceReceiverDevices(
      appservice,
      ["@hookshot:example.org"],
      true,
    );

    expect(getIntentForUserId).not.toHaveBeenCalled();
  });

  it("fails without exposing the underlying request error", async () => {
    const doRequest = vi.fn().mockRejectedValue(new Error("secret token"));
    const { appservice } = createFakeAppservice([], doRequest);

    let error: unknown;
    try {
      await provisionToDeviceReceiverDevices(
        appservice,
        ["@hookshot:example.org"],
        false,
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toEqual(
      new Error(
        `Failed to provision receiver device ${HOOKSHOT_TO_DEVICE_RECEIVER_DEVICE_ID} for bot @hookshot:example.org`,
      ),
    );
    expect(String(error)).not.toContain("secret token");
  });

  it("fails if Synapse does not expose the device as visible", async () => {
    const { appservice } = createFakeAppservice([]);

    await expect(
      provisionToDeviceReceiverDevices(
        appservice,
        ["@hookshot:example.org"],
        false,
      ),
    ).rejects.toThrow("Failed to provision receiver device");
  });
});
