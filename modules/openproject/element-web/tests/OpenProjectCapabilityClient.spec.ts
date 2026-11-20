import { describe, expect, it, vi } from "vitest";
import {
  getOpenProjectCapabilityBot,
  isOpenProjectAnchorContent,
  isOpenProjectAnchorForBot,
  isOpenProjectInactiveAnchorContent,
  isOpenProjectProbeResponse,
  isOpenProjectUpdateContent,
  OPENPROJECT_CAPABILITIES_PROBE_EVENT_TYPE,
  OPENPROJECT_CAPABILITIES_PROBE_RESPONSE_EVENT_TYPE,
  OpenProjectCapabilityClient,
  type OpenProjectAnchor,
  type OpenProjectProbeResponse,
} from "../src/capabilities/OpenProjectCapabilityClient";
import {
  OPENPROJECT_ANCHOR_STATE_INACTIVE,
  OPENPROJECT_EVENT_SCHEMA_VERSION,
  OPENPROJECT_UPDATE_EVENT_KIND,
} from "../src/schema/OpenProjectSchema";
import { activeAnchorContent } from "./fixtures/OpenProjectContractFixtures";
import { MockProfile, MockToDeviceApi } from "./helpers/MockToDeviceApi";

const botUserId = "@hookshot_openproject:example.org";
const secondBotUserId = "@hookshot:example.org";
const anchorContent = activeAnchorContent;

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
  requestId: string,
  result: OpenProjectProbeResponse["result"] = "ok",
): OpenProjectProbeResponse {
  return {
    v: 1,
    request_id: requestId,
    integration_id: "openproject",
    result,
  };
}

function getRequestId(toDevice: MockToDeviceApi, index = 0): string {
  const requestId = toDevice.sentMessages[index]?.content.request_id;
  if (typeof requestId !== "string") {
    throw new Error("Probe did not include a request ID");
  }
  return requestId;
}

function deliverResponse(
  toDevice: MockToDeviceApi,
  requestId: string,
  sender = botUserId,
  content: unknown = createResponse(requestId),
  type = OPENPROJECT_CAPABILITIES_PROBE_RESPONSE_EVENT_TYPE,
): void {
  toDevice.deliver(OPENPROJECT_CAPABILITIES_PROBE_RESPONSE_EVENT_TYPE, {
    type,
    sender,
    content,
  });
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
      isOpenProjectUpdateContent({
        ...anchorContent,
        "org.matrix.matrix-hookshot.openproject.event_kind":
          OPENPROJECT_UPDATE_EVENT_KIND,
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
      isOpenProjectUpdateContent({
        ...anchorContent,
        "org.matrix.matrix-hookshot.openproject.event_kind":
          OPENPROJECT_UPDATE_EVENT_KIND,
        "org.matrix.matrix-hookshot.openproject.work_package": { id: 0 },
      }),
    ).toBe(false);
    expect(
      isOpenProjectProbeResponse({
        ...createResponse("request-1"),
        v: 2,
      }),
    ).toBe(false);
  });

  it("subscribes before sending the version 1 probe to the wildcard device", async () => {
    const toDevice = new MockToDeviceApi();
    const profile = new MockProfile();
    const client = new OpenProjectCapabilityClient(toDevice, profile);
    const probe = client.probe(createAnchor());

    expect(toDevice.calls.slice(0, 2)).toEqual(["subscribe", "send"]);
    expect(toDevice.onMessage).toHaveBeenCalledWith(
      OPENPROJECT_CAPABILITIES_PROBE_RESPONSE_EVENT_TYPE,
      expect.any(Function),
    );
    expect(toDevice.sentMessages).toEqual([
      {
        recipientUserId: botUserId,
        recipientDeviceId: "*",
        type: OPENPROJECT_CAPABILITIES_PROBE_EVENT_TYPE,
        content: {
          v: 1,
          request_id: expect.any(String),
          requesting_device_id: "ALICE_DEVICE",
          integration_id: "openproject",
          room_id: "!room:example.org",
          anchor_event_id: "$anchor-without-server",
        },
      },
    ]);

    const requestId = getRequestId(toDevice);
    deliverResponse(toDevice, requestId);
    await expect(probe).resolves.toEqual(createResponse(requestId));
    expect(toDevice.listenerCount).toBe(0);
    expect(profile.listenerCount).toBe(0);
  });

  it("waits for a response after send succeeds and clears its timeout", async () => {
    vi.useFakeTimers();
    try {
      const toDevice = new MockToDeviceApi();
      const client = new OpenProjectCapabilityClient(
        toDevice,
        new MockProfile(),
      );
      let settled = false;
      const probe = client.probe(createAnchor()).finally(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(toDevice.sendMessage).toHaveBeenCalledOnce();
      expect(settled).toBe(false);
      expect(vi.getTimerCount()).toBe(1);

      const requestId = getRequestId(toDevice);
      deliverResponse(toDevice, requestId);
      await expect(probe).resolves.toEqual(createResponse(requestId));
      expect(settled).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores responses with a wrong type, sender, request ID, or shape", async () => {
    const toDevice = new MockToDeviceApi();
    const client = new OpenProjectCapabilityClient(toDevice, new MockProfile());
    const probe = client.probe(createAnchor());
    const requestId = getRequestId(toDevice);

    deliverResponse(toDevice, requestId, "@spoofed:example.org");
    deliverResponse(
      toDevice,
      requestId,
      botUserId,
      createResponse("different-request"),
    );
    deliverResponse(toDevice, requestId, botUserId, {
      ...createResponse(requestId),
      result: "unexpected",
    });
    deliverResponse(
      toDevice,
      requestId,
      botUserId,
      createResponse(requestId),
      OPENPROJECT_CAPABILITIES_PROBE_EVENT_TYPE,
    );

    expect(toDevice.listenerCount).toBe(1);
    deliverResponse(toDevice, requestId);
    await expect(probe).resolves.toEqual(createResponse(requestId));
  });

  it("coalesces pending probes but sends again after a response", async () => {
    const toDevice = new MockToDeviceApi();
    const client = new OpenProjectCapabilityClient(toDevice, new MockProfile());
    const anchor = createAnchor();

    const first = client.probe(anchor);
    const second = client.probe(anchor);
    expect(second).toBe(first);
    expect(toDevice.sendMessage).toHaveBeenCalledOnce();
    expect(toDevice.listenerCount).toBe(1);

    const firstRequestId = getRequestId(toDevice);
    deliverResponse(toDevice, firstRequestId);
    await expect(first).resolves.toEqual(createResponse(firstRequestId));

    const third = client.probe(anchor);
    expect(third).not.toBe(first);
    const secondRequestId = getRequestId(toDevice, 1);
    deliverResponse(toDevice, secondRequestId);
    await expect(third).resolves.toEqual(createResponse(secondRequestId));
    expect(toDevice.sendMessage).toHaveBeenCalledTimes(2);
  });

  it("keeps probes separate for different anchors and recipient bots", async () => {
    const toDevice = new MockToDeviceApi();
    const client = new OpenProjectCapabilityClient(toDevice, new MockProfile());
    const anchors = [
      createAnchor({ workPackageId: 41 }),
      createAnchor({ workPackageId: 42 }),
      createAnchor({ recipientUserId: secondBotUserId }),
    ];
    const probes = anchors.map((anchor) => client.probe(anchor));

    expect(toDevice.sendMessage).toHaveBeenCalledTimes(3);
    for (const [index, anchor] of anchors.entries()) {
      const requestId = getRequestId(toDevice, index);
      deliverResponse(toDevice, requestId, anchor.recipientUserId);
    }
    await expect(Promise.all(probes)).resolves.toHaveLength(3);
  });

  it("keeps a forced request cached when the older request settles", async () => {
    const toDevice = new MockToDeviceApi();
    const client = new OpenProjectCapabilityClient(toDevice, new MockProfile());
    const anchor = createAnchor();

    const first = client.probe(anchor);
    const forced = client.probe(anchor, { force: true });
    expect(forced).not.toBe(first);

    const firstRequestId = getRequestId(toDevice, 0);
    deliverResponse(toDevice, firstRequestId);
    await expect(first).resolves.toEqual(createResponse(firstRequestId));

    expect(client.probe(anchor)).toBe(forced);
    const forcedRequestId = getRequestId(toDevice, 1);
    deliverResponse(toDevice, forcedRequestId);
    await expect(forced).resolves.toEqual(createResponse(forcedRequestId));
    expect(toDevice.sendMessage).toHaveBeenCalledTimes(2);
  });

  it("cleans up after send failure and permits a retry", async () => {
    const toDevice = new MockToDeviceApi();
    toDevice.failOnSendCall(1, new Error("Hookshot unavailable"));
    const profile = new MockProfile();
    const client = new OpenProjectCapabilityClient(toDevice, profile);
    const anchor = createAnchor();

    await expect(client.probe(anchor)).rejects.toThrow("Hookshot unavailable");
    expect(toDevice.listenerCount).toBe(0);
    expect(profile.listenerCount).toBe(0);

    const retry = client.probe(anchor);
    const requestId = getRequestId(toDevice, 1);
    deliverResponse(
      toDevice,
      requestId,
      botUserId,
      createResponse(requestId, "unavailable"),
    );
    await expect(retry).resolves.toEqual(
      createResponse(requestId, "unavailable"),
    );
    expect(toDevice.sendMessage).toHaveBeenCalledTimes(2);
  });

  it("rejects and cleans up when the profile changes", async () => {
    const toDevice = new MockToDeviceApi();
    const profile = new MockProfile();
    const client = new OpenProjectCapabilityClient(toDevice, profile);
    const probe = client.probe(createAnchor());
    const oldRequestId = getRequestId(toDevice);

    profile.update({ userId: "@bob:example.org", deviceId: "BOB_DEVICE" });
    await expect(probe).rejects.toThrow("Matrix account or device changed");
    expect(toDevice.listenerCount).toBe(0);
    expect(profile.listenerCount).toBe(0);

    deliverResponse(toDevice, oldRequestId);
    expect(toDevice.sendMessage).toHaveBeenCalledOnce();
  });

  it.each([
    { userId: "@bob:example.org", deviceId: "BOB_DEVICE" },
    { userId: "@alice:example.org", deviceId: "ALICE_SECOND_DEVICE" },
  ])(
    "starts a separate probe for a new session before the old probe settles: $deviceId",
    async (newIdentity) => {
      const toDevice = new MockToDeviceApi();
      const profile = new MockProfile();
      const client = new OpenProjectCapabilityClient(toDevice, profile);
      const anchor = createAnchor();
      const first = client.probe(anchor);
      const firstRejection = expect(first).rejects.toThrow(
        "Matrix account or device changed",
      );

      profile.update(newIdentity);
      const second = client.probe(anchor);
      expect(second).not.toBe(first);
      expect(toDevice.sendMessage).toHaveBeenCalledTimes(2);
      expect(toDevice.sentMessages[1].content.requesting_device_id).toBe(
        newIdentity.deviceId,
      );

      const secondRequestId = getRequestId(toDevice, 1);
      deliverResponse(toDevice, secondRequestId);
      await firstRejection;
      await expect(second).resolves.toEqual(createResponse(secondRequestId));
    },
  );

  it("rejects a response if the session changes before the send completes", async () => {
    const toDevice = new MockToDeviceApi();
    const pendingSend = Promise.withResolvers<void>();
    toDevice.sendMessage.mockImplementationOnce(async (message) => {
      toDevice.calls.push("send");
      toDevice.sentMessages.push(message);
      await pendingSend.promise;
    });
    const profile = new MockProfile();
    const client = new OpenProjectCapabilityClient(toDevice, profile);
    const probe = client.probe(createAnchor());
    const rejection = expect(probe).rejects.toThrow(
      "Matrix account or device changed",
    );

    deliverResponse(toDevice, getRequestId(toDevice));
    expect(profile.listenerCount).toBe(0);
    profile.update({ userId: "@bob:example.org", deviceId: "BOB_DEVICE" });
    pendingSend.resolve();

    await rejection;
  });

  it("requires an active user and device before starting a probe", async () => {
    const toDevice = new MockToDeviceApi();
    const client = new OpenProjectCapabilityClient(
      toDevice,
      new MockProfile({ userId: "@alice:example.org" }),
    );

    await expect(client.probe(createAnchor())).rejects.toThrow(
      "No active Matrix user and device",
    );
    expect(toDevice.onMessage).not.toHaveBeenCalled();
    expect(toDevice.sendMessage).not.toHaveBeenCalled();
  });

  it("times out and removes the response and profile listeners", async () => {
    vi.useFakeTimers();
    try {
      const toDevice = new MockToDeviceApi();
      const profile = new MockProfile();
      const client = new OpenProjectCapabilityClient(toDevice, profile);
      const probe = client.probe(createAnchor());
      const rejection = expect(probe).rejects.toThrow(
        "OpenProject capability probe timed out",
      );

      await vi.advanceTimersByTimeAsync(10_000);
      await rejection;
      expect(toDevice.listenerCount).toBe(0);
      expect(profile.listenerCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
