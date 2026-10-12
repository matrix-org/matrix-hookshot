import { type Server } from "node:http";

import {
  Appservice,
  IAppserviceRegistration,
  MemoryStorageProvider,
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

const request = {
  v: HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
  request_id: "appservice-transaction",
  requesting_device_id: "ELEMENTDEVICE",
  integration_id: "generic",
  room_id: "!room:example.org",
  anchor_event_id: "$anchor",
};

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

describe("real appservice to-device delivery", () => {
  it("converts an appservice to-device EDU into a targeted Hookshot response", async () => {
    const registration: IAppserviceRegistration & { receive_ephemeral: true } =
      {
        id: "hookshot-test",
        url: null,
        as_token: "as-token",
        hs_token: "hs-token",
        sender_localpart: "hookshot",
        namespaces: {
          users: [{ regex: "@hookshot:example.org", exclusive: true }],
          rooms: [],
          aliases: [],
        },
        receive_ephemeral: true,
        "io.element.msc4190": true,
      };
    const appservice = new Appservice({
      homeserverName: "example.org",
      homeserverUrl: "http://127.0.0.1:1",
      port: 0,
      bindAddress: "127.0.0.1",
      registration,
      storage: new MemoryStorageProvider(),
    });
    const sendToDevices = vi
      .spyOn(
        appservice.getIntentForUserId(botUserId).underlyingClient,
        "sendToDevices",
      )
      .mockResolvedValue();
    const receiver = new HookshotToDeviceReceiver(
      appservice,
      new Map([["generic", botUserId]]),
    );
    receiver.start();

    const server = appservice.expressAppInstance.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Appservice test server did not expose a TCP address");
    }

    try {
      const response = await fetch(
        `http://127.0.0.1:${address.port}/transactions/transaction-1`,
        {
          method: "PUT",
          headers: {
            Authorization: "Bearer hs-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            events: [],
            "de.sorunome.msc2409.to_device": [
              {
                type: HOOKSHOT_CAPABILITIES_PROBE_EVENT_TYPE,
                sender,
                to_user_id: botUserId,
                to_device_id: "*",
                content: request,
              },
            ],
          }),
        },
      );

      expect(response.status).toBe(200);
      await vi.waitFor(() => expect(sendToDevices).toHaveBeenCalledOnce());
      expect(sendToDevices).toHaveBeenCalledWith(
        HOOKSHOT_CAPABILITIES_PROBE_RESPONSE_EVENT_TYPE,
        {
          [sender]: {
            ELEMENTDEVICE: {
              v: HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
              request_id: request.request_id,
              integration_id: request.integration_id,
              result: "unavailable",
            },
          },
        },
      );
    } finally {
      receiver.stop();
      await closeServer(server);
    }
  });
});
