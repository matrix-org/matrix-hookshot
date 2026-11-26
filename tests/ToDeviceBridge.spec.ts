import { EventEmitter } from "events";
import type { Appservice, Intent } from "matrix-bot-sdk";
import { describe, expect, it, vi } from "vitest";

import { Bridge } from "../src/Bridge";

class FakeAppservice extends EventEmitter {
  public readonly ensureToDeviceReady = vi.fn(
    async (userId: string) => `BOTSDK_DEVICE_${userId}`,
  );

  public readonly getIntentForUserId = vi.fn(
    (userId: string): Intent =>
      ({
        ensureToDeviceReady: () => this.ensureToDeviceReady(userId),
      }) as unknown as Intent,
  );
}

function createBridge(
  appservice: FakeAppservice,
  botUsers: Array<{ userId: string; services: string[] }>,
): Bridge {
  return Object.assign(Object.create(Bridge.prototype), {
    as: appservice as unknown as Appservice,
    botUsersManager: { botUsers },
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

  it("fails startup with the SDK error as its cause without subscribing", async () => {
    const appservice = new FakeAppservice();
    const sdkError = new Error("device registration failed");
    appservice.ensureToDeviceReady.mockRejectedValueOnce(sdkError);
    const bridge = createBridge(appservice, [
      { userId: "@hookshot:example.org", services: ["generic"] },
    ]);

    const startupError = await bridge["startToDeviceReceiver"]().catch(
      (error: unknown) => error,
    );
    expect(startupError).toBeInstanceOf(Error);
    expect((startupError as Error).message).toBe(
      "Failed to prepare to-device receiver for @hookshot:example.org",
    );
    expect((startupError as Error).cause).toBe(sdkError);
    expect(appservice.listenerCount("to-device")).toBe(0);
  });
});
