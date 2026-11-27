import { createHash } from "node:crypto";
import { IToDeviceMessage, MatrixAuth, MatrixClient } from "matrix-bot-sdk";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  HOOKSHOT_CAPABILITIES_PROBE_EVENT_TYPE,
  HOOKSHOT_CAPABILITIES_PROBE_RESPONSE_EVENT_TYPE,
  HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
} from "../src/ToDeviceProtocol";
import { E2ESetupTestTimeout, E2ETestEnv } from "./util/e2e-test";

const RESPONSE_TIMEOUT_MS = 20_000;
const SYNC_BARRIER_EVENT_TYPE = "org.matrix.hookshot.test.sync_barrier";

function waitForToDevice(
  client: MatrixClient,
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
  let serviceBotMxid: string;

  beforeEach(async () => {
    testEnv = await E2ETestEnv.createTestEnv({
      matrixLocalparts: ["user"],
      config: {
        openProject: {
          webhook: { secret: "test-secret" },
          baseUrl: "http://openproject.example/",
        },
        toDevice: { receiver: { enabled: true } },
        serviceBots: [
          {
            localpart: "hookshot_webhooks",
            prefix: "!webhooks",
            service: "generic",
          },
        ],
      },
    });
    serviceBotMxid = `@hookshot_webhooks:${testEnv.homeserver.domain}`;
    await testEnv.setUp();
  }, E2ESetupTestTimeout);

  afterEach(() => testEnv?.tearDown());

  test(
    "routes a probe through the service bot and replies only to the requesting device",
    async () => {
      const user = testEnv.getUser("user");
      const password = createHash("sha256")
        .update("user")
        .update(testEnv.homeserver.containers.synapse.registrationSecret)
        .digest("hex");
      const otherDevice = await new MatrixAuth(
        testEnv.homeserver.url,
      ).passwordLogin("user", password, "Other test device");
      const otherDeviceId = (await otherDevice.getWhoAmI()).device_id;
      if (!otherDeviceId) {
        throw new Error("The second login did not create a Matrix device");
      }
      expect(otherDeviceId).not.toBe(testEnv.homeserver.users[0].deviceId);
      const otherDeviceResponses: IToDeviceMessage[] = [];
      const onOtherDeviceMessage = (message: IToDeviceMessage): void => {
        if (message.type === HOOKSHOT_CAPABILITIES_PROBE_RESPONSE_EVENT_TYPE) {
          otherDeviceResponses.push(message);
        }
      };
      otherDevice.on("to-device", onOtherDeviceMessage);

      try {
        await otherDevice.start();
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
            message.sender === serviceBotMxid &&
            (message.content as Record<string, unknown>).request_id ===
              request.request_id,
        );

        // This invokes the real Matrix client API. Synapse delivers the EDU to
        // Hookshot's appservice transaction, which the SDK turns into the
        // "to-device" event consumed by HookshotToDeviceReceiver.
        await user.sendToDevices(HOOKSHOT_CAPABILITIES_PROBE_EVENT_TYPE, {
          [serviceBotMxid]: {
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
        // A marker sent after the response confirms the second device has
        // synced past the response before we inspect its received events.
        const barrier = waitForToDevice(
          otherDevice,
          (message) => message.type === SYNC_BARRIER_EVENT_TYPE,
        );
        await user.sendToDevices(SYNC_BARRIER_EVENT_TYPE, {
          [testEnv.homeserver.users[0].userId]: {
            [otherDeviceId]: { request_id: request.request_id },
          },
        });
        await barrier;
        expect(otherDeviceResponses).toEqual([]);
      } finally {
        otherDevice.off("to-device", onOtherDeviceMessage);
        otherDevice.stop();
      }
    },
    2 * RESPONSE_TIMEOUT_MS + 10_000,
  );

  test(
    "routes an OpenProject probe through the selected bot",
    async () => {
      const user = testEnv.getUser("user");
      const request = {
        v: HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
        request_id: "openproject-appservice-delivery",
        requesting_device_id: testEnv.homeserver.users[0].deviceId,
        integration_id: "openproject",
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

      await user.sendToDevices(HOOKSHOT_CAPABILITIES_PROBE_EVENT_TYPE, {
        [testEnv.botMxid]: { "*": request },
      });

      const response = await responsePromise;
      expect(response.content).toEqual({
        v: HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
        request_id: request.request_id,
        integration_id: request.integration_id,
        result: "not_authorized",
      });
    },
    RESPONSE_TIMEOUT_MS + 10_000,
  );
});
