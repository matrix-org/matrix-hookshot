import { describe, expect, it, vi } from "vitest";
import {
  getOpenProjectCapabilityBot,
  isOpenProjectAnchorForBot,
  OpenProjectCapabilityClient,
  type OpenProjectProbeResponse,
} from "../src/OpenProjectCapabilityClient";
import type { HookshotToDeviceClient } from "../src/HookshotToDeviceClient";

const botUserId = "@hookshot_openproject:example.org";
const anchorContent = {
  "org.matrix.matrix-hookshot.openproject.schema_version": 1,
  "org.matrix.matrix-hookshot.openproject.event_kind": "anchor",
};

describe("OpenProjectCapabilityClient", () => {
  it("reads only the deployment-configured OpenProject integration bot", () => {
    expect(
      getOpenProjectCapabilityBot({
        "org.matrix.matrix-hookshot": {
          integrationBots: { openproject: botUserId },
        },
      }),
    ).toBe(botUserId);
    expect(
      getOpenProjectCapabilityBot({
        "org.matrix.matrix-hookshot": {
          integrationBots: { openproject: "https://hookshot.example.org" },
        },
      }),
    ).toBeUndefined();
  });

  it("requires the marked anchor and authenticated bot sender", () => {
    expect(isOpenProjectAnchorForBot(anchorContent, botUserId, botUserId)).toBe(
      true,
    );
    expect(
      isOpenProjectAnchorForBot(
        anchorContent,
        "@another:example.org",
        botUserId,
      ),
    ).toBe(false);
    expect(
      isOpenProjectAnchorForBot(
        {
          ...anchorContent,
          "org.matrix.matrix-hookshot.openproject.event_kind": "update",
        },
        botUserId,
        botUserId,
      ),
    ).toBe(false);
  });

  it("sends an integration-neutral probe for the validated anchor", async () => {
    const response: OpenProjectProbeResponse = {
      v: 1,
      request_id: "request-1",
      integration_id: "openproject",
      result: "ok",
      connection: "connected",
    };
    const request = vi.fn().mockResolvedValue(response);
    const client = new OpenProjectCapabilityClient(
      { request } as unknown as HookshotToDeviceClient,
      botUserId,
    );

    await expect(
      client.probe({
        roomId: "!room:example.org",
        eventId: "$anchor-without-server",
      }),
    ).resolves.toEqual(response);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUserId: botUserId,
        requestType: "org.matrix.matrix-hookshot.capabilities.probe",
        responseType: "org.matrix.matrix-hookshot.capabilities.probe_response",
        content: {
          v: 1,
          integration_id: "openproject",
          room_id: "!room:example.org",
          anchor_event_id: "$anchor-without-server",
        },
        responseValidator: expect.any(Function),
      }),
    );
  });

  it("coalesces repeated probes for the same anchor", async () => {
    const response: OpenProjectProbeResponse = {
      v: 1,
      request_id: "request-1",
      integration_id: "openproject",
      result: "ok",
    };
    const request = vi.fn().mockResolvedValue(response);
    const client = new OpenProjectCapabilityClient(
      { request } as unknown as HookshotToDeviceClient,
      botUserId,
    );
    const anchor = {
      roomId: "!room:example.org",
      eventId: "$anchor-without-server",
    };

    const first = client.probe(anchor);
    const second = client.probe(anchor);

    expect(second).toBe(first);
    await expect(second).resolves.toEqual(response);
    expect(request).toHaveBeenCalledOnce();
  });

  it("allows an explicit retry after a failed or unavailable probe", async () => {
    const response: OpenProjectProbeResponse = {
      v: 1,
      request_id: "request-2",
      integration_id: "openproject",
      result: "ok",
    };
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error("Hookshot unavailable"))
      .mockResolvedValueOnce(response);
    const client = new OpenProjectCapabilityClient(
      { request } as unknown as HookshotToDeviceClient,
      botUserId,
    );
    const anchor = {
      roomId: "!room:example.org",
      eventId: "$anchor-without-server",
    };

    await expect(client.probe(anchor)).rejects.toThrow("Hookshot unavailable");
    await expect(client.probe(anchor, { force: true })).resolves.toEqual(
      response,
    );
    expect(request).toHaveBeenCalledTimes(2);
  });
});
