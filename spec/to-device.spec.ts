import { IToDeviceMessage } from "matrix-bot-sdk";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  HOOKSHOT_CAPABILITIES_PROBE_EVENT_TYPE,
  HOOKSHOT_CAPABILITIES_PROBE_RESPONSE_EVENT_TYPE,
  HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
} from "../src/ToDeviceProtocol";
import {
  E2ESetupTestTimeout,
  E2ETestEnv,
  E2ETestMatrixClient,
} from "./util/e2e-test";

const RESPONSE_TIMEOUT_MS = 20_000;

function waitForToDevice(
  client: E2ETestMatrixClient,
  predicate: (message: IToDeviceMessage) => boolean,
): Promise<IToDeviceMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off("to-device", onMessage);
      reject(new Error("Timed out waiting for a to-device response"));
    }, RESPONSE_TIMEOUT_MS);

    const onMessage = (message: IToDeviceMessage): void => {
      if (!predicate(message)) {
        return;
      }

      clearTimeout(timer);
      client.off("to-device", onMessage);
      resolve(message);
    };

    client.on("to-device", onMessage);
  });
}

describe("Appservice to-device delivery", () => {
  let testEnv: E2ETestEnv;

  beforeEach(async () => {
    testEnv = await E2ETestEnv.createTestEnv({ matrixLocalparts: ["user"] });
    await testEnv.setUp();
  }, E2ESetupTestTimeout);

  afterEach(() => testEnv?.tearDown());

  test(
    "delivers a real to-device request through the appservice and replies to the requesting device",
    async () => {
      const user = testEnv.getUser("user");
      const request = {
        v: HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
        request_id: "real-appservice-delivery",
        requesting_device_id: testEnv.homeserver.users[0].deviceId,
        integration_id: "generic",
        room_id: "!transport-proof:example.com",
        anchor_event_id: "$transport-proof",
      };

      const responsePromise = waitForToDevice(
        user,
        (message) =>
          message.type === HOOKSHOT_CAPABILITIES_PROBE_RESPONSE_EVENT_TYPE &&
          message.sender === testEnv.botMxid &&
          (message.content as Record<string, unknown>).request_id ===
            request.request_id,
      );

      // This invokes the real Matrix client API. Synapse delivers the EDU to
      // Hookshot's appservice transaction, which the SDK turns into the
      // ephemeral.event consumed by HookshotToDeviceReceiver.
      await user.sendToDevices(HOOKSHOT_CAPABILITIES_PROBE_EVENT_TYPE, {
        [testEnv.botMxid]: {
          "*": request,
        },
      });

      const response = await responsePromise;
      expect(response.content).toEqual({
        v: HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
        request_id: request.request_id,
        integration_id: request.integration_id,
        result: "unavailable",
      });
    },
    RESPONSE_TIMEOUT_MS + 10_000,
  );
});
