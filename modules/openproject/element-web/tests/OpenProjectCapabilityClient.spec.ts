import { describe, expect, it, vi } from "vitest";
import {
  getOpenProjectCapabilityBot,
  isOpenProjectAnchorContent,
  isOpenProjectAnchorForBot,
  isOpenProjectProbeResponse,
  OpenProjectCapabilityClient,
  type OpenProjectAnchor,
  type OpenProjectProbeResponse,
} from "../src/OpenProjectCapabilityClient";
import {
  OPENPROJECT_ANCHOR_EVENT_KIND,
  OPENPROJECT_EVENT_SCHEMA_VERSION,
} from "../src/OpenProjectSchema";

const botUserId = "@hookshot_openproject:example.org";
const secondBotUserId = "@hookshot:example.org";
const anchorContent = {
  "org.matrix.matrix-hookshot.openproject.schema_version":
    OPENPROJECT_EVENT_SCHEMA_VERSION,
  "org.matrix.matrix-hookshot.openproject.event_kind":
    OPENPROJECT_ANCHOR_EVENT_KIND,
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
  public readonly request = vi.fn();
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

  it("keeps event-schema validation separate from transport validation", () => {
    expect(isOpenProjectAnchorContent(anchorContent)).toBe(true);
    expect(
      isOpenProjectAnchorContent({
        ...anchorContent,
        "org.matrix.matrix-hookshot.openproject.schema_version":
          OPENPROJECT_EVENT_SCHEMA_VERSION + 1,
      }),
    ).toBe(false);

    expect(
      isOpenProjectProbeResponse({
        ...createResponse(),
        v: 2,
      }),
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

  it("coalesces pending probes but sends again after a result", async () => {
    const response = createResponse();
    const toDeviceClient = new FakeToDeviceClient();
    const pending = Promise.withResolvers<OpenProjectProbeResponse>();
    toDeviceClient.request
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(response);
    const client = new OpenProjectCapabilityClient(toDeviceClient as never);
    const anchor = createAnchor();

    const first = client.probe(anchor);
    const second = client.probe(anchor);
    expect(second).toBe(first);
    expect(toDeviceClient.request).toHaveBeenCalledOnce();

    pending.resolve(response);
    await expect(first).resolves.toEqual(response);
    const third = client.probe(anchor);

    expect(third).not.toBe(first);
    await expect(third).resolves.toEqual(response);
    expect(toDeviceClient.request).toHaveBeenCalledTimes(2);
  });

  it("does not share entries between work packages or recipient bots", async () => {
    const toDeviceClient = new FakeToDeviceClient();
    const pending = Promise.withResolvers<OpenProjectProbeResponse>();
    toDeviceClient.request.mockReturnValue(pending.promise);
    const client = new OpenProjectCapabilityClient(toDeviceClient as never);

    const probes = [
      client.probe(createAnchor({ workPackageId: 41 })),
      client.probe(createAnchor({ workPackageId: 42 })),
      client.probe(createAnchor({ recipientUserId: secondBotUserId })),
    ];

    expect(toDeviceClient.request).toHaveBeenCalledTimes(3);
    pending.resolve(createResponse());
    await expect(Promise.all(probes)).resolves.toHaveLength(3);
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

  it("keeps a forced request cached when the older request settles", async () => {
    const toDeviceClient = new FakeToDeviceClient();
    const firstRequest = Promise.withResolvers<OpenProjectProbeResponse>();
    const forcedRequest = Promise.withResolvers<OpenProjectProbeResponse>();
    toDeviceClient.request
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(forcedRequest.promise)
      .mockResolvedValue(createResponse());
    const client = new OpenProjectCapabilityClient(toDeviceClient as never);
    const anchor = createAnchor();

    const first = client.probe(anchor);
    const forced = client.probe(anchor, { force: true });

    expect(forced).not.toBe(first);
    firstRequest.resolve(createResponse());
    await expect(first).resolves.toEqual(createResponse());

    expect(client.probe(anchor)).toBe(forced);
    forcedRequest.resolve(createResponse());
    await expect(forced).resolves.toEqual(createResponse());
    expect(toDeviceClient.request).toHaveBeenCalledTimes(2);
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
