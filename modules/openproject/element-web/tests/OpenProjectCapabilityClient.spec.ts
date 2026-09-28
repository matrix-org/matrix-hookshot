import { describe, expect, it, vi } from "vitest";
import {
  getOpenProjectCapabilityBot,
  isOpenProjectAnchorForBot,
  OpenProjectCapabilityClient,
  type OpenProjectAnchor,
  type OpenProjectProbeResponse,
} from "../src/OpenProjectCapabilityClient";
import type { MatrixSessionIdentity } from "../src/HookshotToDeviceClient";

const botUserId = "@hookshot_openproject:example.org";
const secondBotUserId = "@hookshot:example.org";
const anchorContent = {
  "org.matrix.matrix-hookshot.openproject.schema_version": 1,
  "org.matrix.matrix-hookshot.openproject.event_kind": "anchor",
};

function createAnchor(
  overrides: Partial<OpenProjectAnchor> = {},
): OpenProjectAnchor {
  return {
    roomId: "!room:example.org",
    eventId: "$anchor-without-server",
    workPackageId: 41,
    recipientUserId: botUserId,
    ...overrides,
  };
}

function createResponse(
  result: OpenProjectProbeResponse["result"] = "ok",
): OpenProjectProbeResponse {
  return {
    v: 1,
    request_id: "request-1",
    integration_id: "openproject",
    result,
  };
}

class FakeToDeviceClient {
  public identity: MatrixSessionIdentity = {
    userId: "@alice:example.org",
    deviceId: "ALICEDEVICE",
  };

  public readonly request = vi.fn();

  public getSessionIdentity(): MatrixSessionIdentity {
    return Object.freeze({ ...this.identity });
  }
}

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

  it("sends an integration-neutral probe with the validated anchor inputs", async () => {
    const response = createResponse();
    const toDeviceClient = new FakeToDeviceClient();
    toDeviceClient.request.mockResolvedValue(response);
    const client = new OpenProjectCapabilityClient(toDeviceClient as never);

    await expect(client.probe(createAnchor())).resolves.toEqual(response);
    expect(toDeviceClient.request).toHaveBeenCalledWith(
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

  it("coalesces identical in-flight and fulfilled probes", async () => {
    const response = createResponse();
    const toDeviceClient = new FakeToDeviceClient();
    toDeviceClient.request.mockResolvedValue(response);
    const client = new OpenProjectCapabilityClient(toDeviceClient as never);
    const anchor = createAnchor();

    const first = client.probe(anchor);
    const second = client.probe(anchor);
    await expect(first).resolves.toEqual(response);
    const third = client.probe(anchor);

    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(toDeviceClient.request).toHaveBeenCalledOnce();
  });

  it("does not share entries between work packages or recipient bots", async () => {
    const toDeviceClient = new FakeToDeviceClient();
    toDeviceClient.request.mockResolvedValue(createResponse());
    const client = new OpenProjectCapabilityClient(toDeviceClient as never);

    await client.probe(createAnchor({ workPackageId: 41 }));
    await client.probe(createAnchor({ workPackageId: 42 }));
    await client.probe(createAnchor({ recipientUserId: secondBotUserId }));

    expect(toDeviceClient.request).toHaveBeenCalledTimes(3);
  });

  it("does not retain rejected or unavailable probes", async () => {
    const toDeviceClient = new FakeToDeviceClient();
    toDeviceClient.request
      .mockRejectedValueOnce(new Error("Hookshot unavailable"))
      .mockResolvedValueOnce(createResponse("unavailable"))
      .mockResolvedValueOnce(createResponse("ok"));
    const client = new OpenProjectCapabilityClient(toDeviceClient as never);
    const anchor = createAnchor();

    await expect(client.probe(anchor)).rejects.toThrow("Hookshot unavailable");
    await expect(client.probe(anchor)).resolves.toMatchObject({
      result: "unavailable",
    });
    await expect(client.probe(anchor)).resolves.toMatchObject({ result: "ok" });
    expect(toDeviceClient.request).toHaveBeenCalledTimes(3);
  });

  it("replaces an existing entry when force is true", async () => {
    const toDeviceClient = new FakeToDeviceClient();
    toDeviceClient.request.mockResolvedValue(createResponse());
    const client = new OpenProjectCapabilityClient(toDeviceClient as never);
    const anchor = createAnchor();

    const first = client.probe(anchor);
    const forced = client.probe(anchor, { force: true });

    expect(forced).not.toBe(first);
    await expect(forced).resolves.toEqual(createResponse());
    expect(toDeviceClient.request).toHaveBeenCalledTimes(2);
  });

  it("clears every cached result when the user changes", async () => {
    const toDeviceClient = new FakeToDeviceClient();
    toDeviceClient.request.mockResolvedValue(createResponse());
    const client = new OpenProjectCapabilityClient(toDeviceClient as never);
    const anchor = createAnchor();

    await client.probe(anchor);
    toDeviceClient.identity = {
      userId: "@bob:example.org",
      deviceId: "BOBDEVICE",
    };
    await client.probe(anchor);

    expect(toDeviceClient.request).toHaveBeenCalledTimes(2);
  });

  it("clears every cached result when only the device changes", async () => {
    const toDeviceClient = new FakeToDeviceClient();
    toDeviceClient.request.mockResolvedValue(createResponse());
    const client = new OpenProjectCapabilityClient(toDeviceClient as never);
    const anchor = createAnchor();

    await client.probe(anchor);
    toDeviceClient.identity = {
      userId: "@alice:example.org",
      deviceId: "ALICESECONDDEVICE",
    };
    await client.probe(anchor);

    expect(toDeviceClient.request).toHaveBeenCalledTimes(2);
  });

  it("rejects a result that arrives after the session changes", async () => {
    const toDeviceClient = new FakeToDeviceClient();
    let resolveRequest!: (response: OpenProjectProbeResponse) => void;
    toDeviceClient.request.mockImplementation(
      () =>
        new Promise<OpenProjectProbeResponse>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const client = new OpenProjectCapabilityClient(toDeviceClient as never);
    const probe = client.probe(createAnchor());

    toDeviceClient.identity = {
      userId: "@bob:example.org",
      deviceId: "BOBDEVICE",
    };
    resolveRequest(createResponse());

    await expect(probe).rejects.toThrow("Matrix account changed");
  });

  it("allows an explicit retry after a failed probe", async () => {
    const response = createResponse();
    const toDeviceClient = new FakeToDeviceClient();
    toDeviceClient.request
      .mockRejectedValueOnce(new Error("Hookshot unavailable"))
      .mockResolvedValueOnce(response);
    const client = new OpenProjectCapabilityClient(toDeviceClient as never);
    const anchor = createAnchor();

    await expect(client.probe(anchor)).rejects.toThrow("Hookshot unavailable");
    await expect(client.probe(anchor, { force: true })).resolves.toEqual(
      response,
    );
    expect(toDeviceClient.request).toHaveBeenCalledTimes(2);
  });
});
