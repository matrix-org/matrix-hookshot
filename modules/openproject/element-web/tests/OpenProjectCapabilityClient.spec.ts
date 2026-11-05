import { describe, expect, it, vi } from "vitest";
import {
  getOpenProjectCapabilityBot,
  isOpenProjectAnchorContent,
  isOpenProjectAnchorForBot,
  isOpenProjectInactiveAnchorContent,
  isOpenProjectProbeResponse,
  isOpenProjectActivityContent,
  OpenProjectCapabilityClient,
  type OpenProjectAnchor,
  type OpenProjectProbeResponse,
} from "../src/OpenProjectCapabilityClient";
import type {
  HookshotToDeviceRequest,
  MatrixSessionIdentity,
} from "../src/HookshotToDeviceClient";
import {
  OPENPROJECT_ANCHOR_STATE_INACTIVE,
  OPENPROJECT_EVENT_SCHEMA_VERSION,
  OPENPROJECT_ACTIVITY_EVENT_KIND,
} from "../src/OpenProjectSchema";
import { activeAnchorContent } from "./fixtures/OpenProjectContractFixtures";

const botUserId = "@hookshot_openproject:example.org";
const secondBotUserId = "@hookshot:example.org";
const anchorContent = activeAnchorContent;

function createAnchor(
  overrides: Partial<OpenProjectAnchor> = {},
): OpenProjectAnchor {
  return {
    roomId: "!room:example.org",
    eventId: "$anchor-without-server",
    snapshotId: "snapshot-1",
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

  public readonly request =
    vi.fn<
      (request: HookshotToDeviceRequest) => Promise<OpenProjectProbeResponse>
    >();

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
          "org.matrix.matrix-hookshot.openproject.event_kind": "activity",
        },
        botUserId,
        botUserId,
      ),
    ).toBe(false);

    const inactiveAnchor = {
      ...anchorContent,
      "org.matrix.matrix-hookshot.openproject.anchor_state":
        OPENPROJECT_ANCHOR_STATE_INACTIVE,
    };
    expect(isOpenProjectInactiveAnchorContent(inactiveAnchor)).toBe(true);
    expect(
      isOpenProjectAnchorForBot(inactiveAnchor, botUserId, botUserId),
    ).toBe(false);

    expect(
      isOpenProjectActivityContent({
        ...anchorContent,
        "org.matrix.matrix-hookshot.openproject.event_kind":
          OPENPROJECT_ACTIVITY_EVENT_KIND,
        "org.matrix.matrix-hookshot.openproject.work_package": {
          id: 41,
          subject: "Example",
          url: "https://openproject.example/work_packages/41",
        },
        "org.matrix.matrix-hookshot.openproject.changes": [],
      }),
    ).toBe(true);
  });

  it("keeps event-schema validation separate from transport validation", () => {
    expect(isOpenProjectAnchorContent(anchorContent)).toBe(true);
    const legacyAnchorContent = { ...anchorContent };
    Reflect.deleteProperty(
      legacyAnchorContent,
      "org.matrix.matrix-hookshot.openproject.anchor_state",
    );
    expect(isOpenProjectAnchorContent(legacyAnchorContent)).toBe(false);
    expect(
      isOpenProjectAnchorContent({
        ...anchorContent,
        "org.matrix.matrix-hookshot.openproject.schema_version":
          OPENPROJECT_EVENT_SCHEMA_VERSION + 1,
      }),
    ).toBe(false);
    expect(
      isOpenProjectAnchorContent({
        ...anchorContent,
        "org.matrix.matrix-hookshot.openproject.anchor_state": "unknown",
      }),
    ).toBe(false);
    expect(
      isOpenProjectAnchorContent({
        ...anchorContent,
        "org.matrix.matrix-hookshot.openproject.work_package": { id: 0 },
      }),
    ).toBe(false);
    expect(
      isOpenProjectActivityContent({
        ...anchorContent,
        "org.matrix.matrix-hookshot.openproject.event_kind":
          OPENPROJECT_ACTIVITY_EVENT_KIND,
        "org.matrix.matrix-hookshot.openproject.work_package": { id: 0 },
      }),
    ).toBe(false);
    expect(
      isOpenProjectProbeResponse({
        ...createResponse(),
        v: 2,
      }),
    ).toBe(false);
  });

  it("validates known capability actions and their explicit commands", () => {
    const response = {
      ...createResponse(),
      connection: "connected" as const,
      actions: [
        {
          id: "assign_self",
          label: "Assign to me",
          command: "!openproject project assign 41",
        },
        {
          id: "mark_done",
          label: "Mark as done",
          command: "!openproject project close 41",
        },
      ],
    };
    expect(isOpenProjectProbeResponse(response)).toBe(true);
    expect(isOpenProjectProbeResponse(response, 41)).toBe(true);
    expect(
      isOpenProjectProbeResponse(
        {
          ...response,
          actions: [
            {
              id: "assign_self",
              label: "Assign to me",
              command: "!openproject project assign 42",
            },
          ],
        },
        41,
      ),
    ).toBe(false);
    expect(
      isOpenProjectProbeResponse({
        ...response,
        actions: [
          { id: "archive", label: "Archive", command: "!openproject close 41" },
        ],
      }),
    ).toBe(false);
    expect(
      isOpenProjectProbeResponse({
        ...response,
        actions: [
          {
            id: "assign_self",
            label: "Assign to me",
            command: "!openproject project close 41",
          },
        ],
      }),
    ).toBe(false);
    expect(
      isOpenProjectProbeResponse({
        ...response,
        result: "not_authorized",
        connection: undefined,
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
    const request = toDeviceClient.request.mock.calls[0][0];
    expect(
      request.responseValidator?.({
        ...response,
        connection: "connected",
        actions: [
          {
            id: "assign_self",
            label: "Assign to me",
            command: "!openproject project assign 42",
          },
        ],
      }),
    ).toBe(false);
  });

  it("coalesces identical in-flight probes and discards settled responses", async () => {
    const response = createResponse();
    const toDeviceClient = new FakeToDeviceClient();
    toDeviceClient.request.mockResolvedValue(response);
    const client = new OpenProjectCapabilityClient(toDeviceClient as never);
    const anchor = createAnchor();

    const first = client.probe(anchor);
    const second = client.probe(anchor);
    const third = client.probe(anchor);

    expect(second).toBe(first);
    expect(third).toBe(first);
    await expect(first).resolves.toEqual(response);
    await expect(client.probe(anchor)).resolves.toEqual(response);
    expect(toDeviceClient.request).toHaveBeenCalledTimes(2);
  });

  it("does not share probes between cards, rooms, bots, or replacements", async () => {
    const toDeviceClient = new FakeToDeviceClient();
    toDeviceClient.request.mockResolvedValue(createResponse());
    const client = new OpenProjectCapabilityClient(toDeviceClient as never);

    await client.probe(createAnchor({ workPackageId: 41 }));
    await client.probe(createAnchor({ workPackageId: 42 }));
    await client.probe(createAnchor({ recipientUserId: secondBotUserId }));
    await client.probe(createAnchor({ roomId: "!another:example.org" }));
    await client.probe(createAnchor({ snapshotId: "snapshot-2" }));

    expect(toDeviceClient.request).toHaveBeenCalledTimes(5);
  });

  it("coalesces a retry only while the matching probe is still pending", async () => {
    const toDeviceClient = new FakeToDeviceClient();
    let resolveRequest!: (response: OpenProjectProbeResponse) => void;
    toDeviceClient.request.mockImplementation(
      () =>
        new Promise<OpenProjectProbeResponse>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const client = new OpenProjectCapabilityClient(toDeviceClient as never);
    const anchor = createAnchor();

    const first = client.probe(anchor);
    const retryWhilePending = client.probe(anchor);
    expect(retryWhilePending).toBe(first);
    resolveRequest(createResponse());
    await expect(first).resolves.toEqual(createResponse());

    const retryAfterSettlement = client.probe(anchor);
    expect(retryAfterSettlement).not.toBe(first);
    expect(toDeviceClient.request).toHaveBeenCalledTimes(2);
    resolveRequest(createResponse());
    await expect(retryAfterSettlement).resolves.toEqual(createResponse());
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

  it("clears in-flight references when the user changes", async () => {
    const toDeviceClient = new FakeToDeviceClient();
    toDeviceClient.request.mockResolvedValue(createResponse());
    const client = new OpenProjectCapabilityClient(toDeviceClient as never);
    const anchor = createAnchor();

    const first = client.probe(anchor);
    toDeviceClient.identity = {
      userId: "@bob:example.org",
      deviceId: "BOBDEVICE",
    };
    const second = client.probe(anchor);

    expect(toDeviceClient.request).toHaveBeenCalledTimes(2);
    expect(second).not.toBe(first);
    await expect(first).rejects.toThrow("Matrix account changed");
    await expect(second).resolves.toEqual(createResponse());
  });

  it("clears in-flight references when only the device changes", async () => {
    const toDeviceClient = new FakeToDeviceClient();
    toDeviceClient.request.mockResolvedValue(createResponse());
    const client = new OpenProjectCapabilityClient(toDeviceClient as never);
    const anchor = createAnchor();

    const first = client.probe(anchor);
    toDeviceClient.identity = {
      userId: "@alice:example.org",
      deviceId: "ALICESECONDDEVICE",
    };
    const second = client.probe(anchor);

    expect(toDeviceClient.request).toHaveBeenCalledTimes(2);
    expect(second).not.toBe(first);
    await expect(first).rejects.toThrow("Matrix account changed");
    await expect(second).resolves.toEqual(createResponse());
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
    await expect(client.probe(anchor)).resolves.toEqual(response);
    expect(toDeviceClient.request).toHaveBeenCalledTimes(2);
  });
});
