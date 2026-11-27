import { describe, expect, it, vi } from "vitest";
import {
  isOpenProjectAnchorContent,
  isOpenProjectAnchorForBot,
  isOpenProjectInactiveAnchorContent,
  isOpenProjectProbeResponse,
  isOpenProjectLoginStartResponse,
  isOpenProjectLoginStatusResponse,
  isOpenProjectActivityContent,
  HOOKSHOT_CAPABILITIES_PROBE_EVENT_TYPE,
  HOOKSHOT_CAPABILITIES_PROBE_RESPONSE_EVENT_TYPE,
  HOOKSHOT_LOGIN_START_EVENT_TYPE,
  HOOKSHOT_LOGIN_START_RESPONSE_EVENT_TYPE,
  HOOKSHOT_LOGIN_STATUS_EVENT_TYPE,
  HOOKSHOT_LOGIN_STATUS_RESPONSE_EVENT_TYPE,
  OpenProjectCapabilityClient,
  type OpenProjectAnchor,
  type OpenProjectProbeResponse,
} from "../src/capabilities/OpenProjectCapabilityClient";
import {
  getOpenProjectBaseUrl,
  getOpenProjectCapabilityBot,
  isTrustedOpenProjectAuthorizationUrl,
} from "../src/utils/config";
import {
  OPENPROJECT_ANCHOR_STATE_INACTIVE,
  OPENPROJECT_EVENT_SCHEMA_VERSION,
  OPENPROJECT_ACTIVITY_EVENT_KIND,
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
    snapshotId: "snapshot-1",
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
  type = HOOKSHOT_CAPABILITIES_PROBE_RESPONSE_EVENT_TYPE,
): void {
  toDevice.deliver(HOOKSHOT_CAPABILITIES_PROBE_RESPONSE_EVENT_TYPE, {
    type,
    sender,
    content,
  });
}

function deliverLoginResponse(
  toDevice: MockToDeviceApi,
  responseType: string,
  content: unknown,
  sender = botUserId,
  messageType = responseType,
): void {
  toDevice.deliver(responseType, {
    type: messageType,
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
        ...createResponse("request-1"),
        v: 2,
      }),
    ).toBe(false);
  });

  it("validates known capability actions and their explicit commands", () => {
    const response = {
      ...createResponse("request-1"),
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

  it("accepts login capability only on not-connected probe responses", () => {
    expect(
      isOpenProjectProbeResponse({
        ...createResponse("request-1", "not_connected"),
        login: "available",
      }),
    ).toBe(true);
    expect(
      isOpenProjectProbeResponse({
        ...createResponse("request-1", "not_connected"),
        login: "not_authorized",
      }),
    ).toBe(true);
    expect(
      isOpenProjectProbeResponse({
        ...createResponse("request-1", "not_connected"),
        login: "unavailable",
      }),
    ).toBe(true);
    expect(
      isOpenProjectProbeResponse(createResponse("request-1", "not_connected")),
    ).toBe(true);
    expect(
      isOpenProjectProbeResponse({
        ...createResponse("request-1"),
        login: "available",
      }),
    ).toBe(false);
    expect(
      isOpenProjectProbeResponse({
        ...createResponse("request-1", "not_authorized"),
        login: "available",
      }),
    ).toBe(false);
    expect(
      isOpenProjectProbeResponse({
        ...createResponse("request-1", "not_connected"),
        login: "unknown",
      }),
    ).toBe(false);
    expect(
      isOpenProjectProbeResponse({
        ...createResponse("request-1", "not_connected"),
        unexpected: true,
      }),
    ).toBe(false);
  });

  it("validates strict login-start and status response variants", () => {
    const responseBase = {
      v: 1,
      request_id: "request-1",
      integration_id: "openproject",
    };
    expect(
      isOpenProjectLoginStartResponse({
        ...responseBase,
        result: "ready",
        auth_url: "https://projects.example.org/oauth/authorize?state=secret",
      }),
    ).toBe(true);
    for (const result of [
      "already_connected",
      "not_authorized",
      "unavailable",
    ] as const) {
      expect(isOpenProjectLoginStartResponse({ ...responseBase, result })).toBe(
        true,
      );
      expect(
        isOpenProjectLoginStartResponse({
          ...responseBase,
          result,
          auth_url: undefined,
        }),
      ).toBe(false);
    }
    expect(
      isOpenProjectLoginStartResponse({
        ...responseBase,
        result: "ready",
        auth_url: "",
      }),
    ).toBe(false);
    expect(
      isOpenProjectLoginStartResponse({
        ...responseBase,
        result: "ready",
        auth_url: `https://projects.example.org/${"a".repeat(4096)}`,
      }),
    ).toBe(false);
    expect(
      isOpenProjectLoginStartResponse({
        ...responseBase,
        result: "ready",
        auth_url: "https://projects.example.org/oauth/authorize",
        extra: true,
      }),
    ).toBe(false);
    expect(
      isOpenProjectLoginStatusResponse({
        ...responseBase,
        result: "connected",
      }),
    ).toBe(true);
    expect(
      isOpenProjectLoginStatusResponse({
        ...responseBase,
        result: "not_connected",
      }),
    ).toBe(true);
    expect(
      isOpenProjectLoginStatusResponse({
        ...responseBase,
        result: "unavailable",
      }),
    ).toBe(true);
    expect(
      isOpenProjectLoginStatusResponse({ ...responseBase, result: "ready" }),
    ).toBe(false);
    expect(
      isOpenProjectLoginStatusResponse({
        ...responseBase,
        result: "connected",
        auth_url: "https://projects.example.org/oauth/authorize",
      }),
    ).toBe(false);
    expect(
      isOpenProjectLoginStatusResponse({
        ...responseBase,
        request_id: " ",
        result: "connected",
      }),
    ).toBe(false);
  });

  it("validates the configured base and trusted OAuth endpoint independently", () => {
    const configure = (openProjectBaseUrl: unknown): unknown => ({
      "org.matrix.matrix-hookshot": { openProjectBaseUrl },
    });
    expect(
      getOpenProjectBaseUrl(configure("https://Projects.Example.org:443/root/"))
        ?.href,
    ).toBe("https://projects.example.org/root/");
    expect(
      getOpenProjectBaseUrl(configure("http://localhost:3000/"))?.origin,
    ).toBe("http://localhost:3000");
    expect(
      getOpenProjectBaseUrl(configure("http://127.0.0.1:3000/")),
    ).toBeInstanceOf(URL);
    expect(
      getOpenProjectBaseUrl(configure("http://[::1]:3000/")),
    ).toBeInstanceOf(URL);
    for (const invalid of [
      "http://projects.example.org",
      "https://user:password@projects.example.org",
      "https://@projects.example.org",
      "https://projects.example.org?query=1",
      "https://projects.example.org#fragment",
      "https://projects.example.org?",
      "https://projects.example.org#",
      "http://192.168.1.10",
      "not a URL",
    ]) {
      expect(
        getOpenProjectBaseUrl(configure(invalid)),
        invalid,
      ).toBeUndefined();
    }
    expect(
      getOpenProjectBaseUrl({
        hookshot: { openProjectBaseUrl: "https://projects.example.org" },
      }),
    ).toBeUndefined();

    const trustedBase = getOpenProjectBaseUrl(
      configure("https://Projects.Example.org:443/project/"),
    );
    expect(
      isTrustedOpenProjectAuthorizationUrl(
        "https://projects.example.org/oauth/authorize?state=x&client_id=y",
        trustedBase,
      ),
    ).toBe(true);
    expect(
      isTrustedOpenProjectAuthorizationUrl(
        "https://PROJECTS.example.org:443/oauth/authorize?state=x",
        trustedBase,
      ),
    ).toBe(true);
    expect(
      isTrustedOpenProjectAuthorizationUrl(
        "https://projects.example.org/oauth/../oauth/authorize?state=x",
        trustedBase,
      ),
    ).toBe(true);
    for (const invalid of [
      "https://projects.example.org/oauth/authorize/extra",
      "https://projects.example.org/elsewhere",
      "https://attacker.example.org/oauth/authorize",
      "https://user@projects.example.org/oauth/authorize",
      "https://@projects.example.org/oauth/authorize",
      "https://projects.example.org/oauth/authorize#fragment",
      "https://projects.example.org/oauth/authorize#",
      "http://projects.example.org/oauth/authorize",
      "not a URL",
    ]) {
      expect(
        isTrustedOpenProjectAuthorizationUrl(invalid, trustedBase),
        invalid,
      ).toBe(false);
    }
    expect(
      isTrustedOpenProjectAuthorizationUrl(
        "http://[::1]:3000/oauth/authorize?state=x",
        getOpenProjectBaseUrl(configure("http://[::1]:3000")),
      ),
    ).toBe(true);
    expect(
      isTrustedOpenProjectAuthorizationUrl(
        "https://projects.example.org/oauth/authorize",
        undefined,
      ),
    ).toBe(false);
  });

  it("subscribes before sending the version 1 probe to the wildcard device", async () => {
    const toDevice = new MockToDeviceApi();
    const profile = new MockProfile();
    const client = new OpenProjectCapabilityClient(toDevice, profile);
    const probe = client.probe(createAnchor());

    expect(toDevice.calls.slice(0, 2)).toEqual(["subscribe", "send"]);
    expect(toDevice.onMessage).toHaveBeenCalledWith(
      HOOKSHOT_CAPABILITIES_PROBE_RESPONSE_EVENT_TYPE,
      expect.any(Function),
    );
    expect(toDevice.sentMessages).toEqual([
      {
        recipientUserId: botUserId,
        recipientDeviceId: "*",
        type: HOOKSHOT_CAPABILITIES_PROBE_EVENT_TYPE,
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

  it("sends fresh correlated login-start and status requests to the bot", async () => {
    const toDevice = new MockToDeviceApi();
    const client = new OpenProjectCapabilityClient(toDevice, new MockProfile());
    const anchor = createAnchor();

    const firstStart = client.loginStart(anchor);
    const secondStart = client.loginStart(anchor);
    const status = client.loginStatus(anchor);

    expect(toDevice.calls.slice(0, 6)).toEqual([
      "subscribe",
      "send",
      "subscribe",
      "send",
      "subscribe",
      "send",
    ]);
    expect(toDevice.sentMessages).toEqual([
      {
        recipientUserId: botUserId,
        recipientDeviceId: "*",
        type: HOOKSHOT_LOGIN_START_EVENT_TYPE,
        content: {
          v: 1,
          request_id: expect.any(String),
          requesting_device_id: "ALICE_DEVICE",
          integration_id: "openproject",
          room_id: "!room:example.org",
          anchor_event_id: "$anchor-without-server",
        },
      },
      {
        recipientUserId: botUserId,
        recipientDeviceId: "*",
        type: HOOKSHOT_LOGIN_START_EVENT_TYPE,
        content: {
          v: 1,
          request_id: expect.any(String),
          requesting_device_id: "ALICE_DEVICE",
          integration_id: "openproject",
          room_id: "!room:example.org",
          anchor_event_id: "$anchor-without-server",
        },
      },
      {
        recipientUserId: botUserId,
        recipientDeviceId: "*",
        type: HOOKSHOT_LOGIN_STATUS_EVENT_TYPE,
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
    const requestIds = toDevice.sentMessages.map((message) =>
      String(message.content.request_id),
    );
    expect(new Set(requestIds).size).toBe(3);

    const ready = {
      v: 1,
      request_id: requestIds[0],
      integration_id: "openproject",
      result: "ready",
      auth_url: "https://projects.example.org/oauth/authorize?state=safe-test",
    };
    const alreadyConnected = {
      v: 1,
      request_id: requestIds[1],
      integration_id: "openproject",
      result: "already_connected",
    };
    const connected = {
      v: 1,
      request_id: requestIds[2],
      integration_id: "openproject",
      result: "connected",
    };
    deliverLoginResponse(
      toDevice,
      HOOKSHOT_LOGIN_START_RESPONSE_EVENT_TYPE,
      ready,
    );
    deliverLoginResponse(
      toDevice,
      HOOKSHOT_LOGIN_START_RESPONSE_EVENT_TYPE,
      alreadyConnected,
    );
    deliverLoginResponse(
      toDevice,
      HOOKSHOT_LOGIN_STATUS_RESPONSE_EVENT_TYPE,
      connected,
    );

    await expect(firstStart).resolves.toEqual(ready);
    await expect(secondStart).resolves.toEqual(alreadyConnected);
    await expect(status).resolves.toEqual(connected);
    expect(toDevice.listenerCount).toBe(0);
  });

  it("accepts each login-start and login-status result variant", async () => {
    const toDevice = new MockToDeviceApi();
    const profile = new MockProfile();
    const client = new OpenProjectCapabilityClient(toDevice, profile);
    const startResults = [
      {
        result: "ready",
        auth_url: "https://projects.example.org/oauth/authorize?state=x",
      },
      { result: "already_connected" },
      { result: "not_authorized" },
      { result: "unavailable" },
    ];
    const statusResults = [
      { result: "connected" },
      { result: "not_connected" },
      { result: "unavailable" },
    ];
    const startPromises = startResults.map(() =>
      client.loginStart(createAnchor()),
    );
    const statusPromises = statusResults.map(() =>
      client.loginStatus(createAnchor()),
    );

    let requestIndex = 0;
    for (const result of startResults) {
      const requestId = getRequestId(toDevice, requestIndex++);
      deliverLoginResponse(toDevice, HOOKSHOT_LOGIN_START_RESPONSE_EVENT_TYPE, {
        v: 1,
        request_id: requestId,
        integration_id: "openproject",
        ...result,
      });
    }
    for (const result of statusResults) {
      const requestId = getRequestId(toDevice, requestIndex++);
      deliverLoginResponse(
        toDevice,
        HOOKSHOT_LOGIN_STATUS_RESPONSE_EVENT_TYPE,
        {
          v: 1,
          request_id: requestId,
          integration_id: "openproject",
          ...result,
        },
      );
    }

    await expect(Promise.all(startPromises)).resolves.toHaveLength(4);
    await expect(Promise.all(statusPromises)).resolves.toHaveLength(3);
    expect(toDevice.listenerCount).toBe(0);
    expect(profile.listenerCount).toBe(0);
  });

  it("ignores unsolicited and mismatched login-start responses", async () => {
    const toDevice = new MockToDeviceApi();
    const client = new OpenProjectCapabilityClient(toDevice, new MockProfile());
    const start = client.loginStart(createAnchor());
    const requestId = getRequestId(toDevice);
    const response = {
      v: 1,
      request_id: requestId,
      integration_id: "openproject",
      result: "already_connected",
    };

    deliverLoginResponse(
      toDevice,
      HOOKSHOT_LOGIN_START_RESPONSE_EVENT_TYPE,
      response,
      "@spoofed:example.org",
    );
    deliverLoginResponse(
      toDevice,
      HOOKSHOT_LOGIN_START_RESPONSE_EVENT_TYPE,
      response,
      botUserId,
      HOOKSHOT_LOGIN_STATUS_RESPONSE_EVENT_TYPE,
    );
    deliverLoginResponse(toDevice, HOOKSHOT_LOGIN_START_RESPONSE_EVENT_TYPE, {
      ...response,
      request_id: "different-request",
    });
    deliverLoginResponse(toDevice, HOOKSHOT_LOGIN_START_RESPONSE_EVENT_TYPE, {
      ...response,
      integration_id: "github",
    });
    deliverLoginResponse(toDevice, HOOKSHOT_LOGIN_START_RESPONSE_EVENT_TYPE, {
      ...response,
      auth_url: undefined,
    });
    expect(toDevice.listenerCount).toBe(1);

    deliverLoginResponse(
      toDevice,
      HOOKSHOT_LOGIN_START_RESPONSE_EVENT_TYPE,
      response,
    );
    await expect(start).resolves.toEqual(response);
    expect(toDevice.listenerCount).toBe(0);
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
      HOOKSHOT_CAPABILITIES_PROBE_EVENT_TYPE,
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

  it("times out a probe and removes the response and profile listeners", async () => {
    vi.useFakeTimers();
    try {
      const toDevice = new MockToDeviceApi();
      const profile = new MockProfile();
      const client = new OpenProjectCapabilityClient(toDevice, profile);
      const probe = client.probe(createAnchor());
      const rejection = expect(probe).rejects.toThrow(
        "OpenProject to-device request timed out",
      );

      await vi.advanceTimersByTimeAsync(10_000);
      await rejection;
      expect(toDevice.listenerCount).toBe(0);
      expect(profile.listenerCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out login-status and ignores a late response", async () => {
    vi.useFakeTimers();
    try {
      const toDevice = new MockToDeviceApi();
      const profile = new MockProfile();
      const client = new OpenProjectCapabilityClient(toDevice, profile);
      const status = client.loginStatus(createAnchor());
      const requestId = getRequestId(toDevice);
      const rejection = expect(status).rejects.toThrow(
        "OpenProject to-device request timed out",
      );

      await vi.advanceTimersByTimeAsync(10_000);
      await rejection;
      expect(toDevice.listenerCount).toBe(0);
      expect(profile.listenerCount).toBe(0);
      deliverLoginResponse(
        toDevice,
        HOOKSHOT_LOGIN_STATUS_RESPONSE_EVENT_TYPE,
        {
          v: 1,
          request_id: requestId,
          integration_id: "openproject",
          result: "connected",
        },
      );
      expect(toDevice.sendMessage).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cleans up login-start listeners after send failure", async () => {
    const toDevice = new MockToDeviceApi();
    toDevice.failOnSendCall(1, new Error("Hookshot unavailable"));
    const profile = new MockProfile();
    const client = new OpenProjectCapabilityClient(toDevice, profile);

    await expect(client.loginStart(createAnchor())).rejects.toThrow(
      "Hookshot unavailable",
    );
    expect(toDevice.listenerCount).toBe(0);
    expect(profile.listenerCount).toBe(0);
  });

  it.each([
    {
      operation: "login-start",
      session: "account",
      identity: { userId: "@bob:example.org", deviceId: "BOB_DEVICE" },
      invoke: (
        client: OpenProjectCapabilityClient,
        anchor: OpenProjectAnchor,
      ) => client.loginStart(anchor),
    },
    {
      operation: "login-start",
      session: "device",
      identity: {
        userId: "@alice:example.org",
        deviceId: "ALICE_SECOND_DEVICE",
      },
      invoke: (
        client: OpenProjectCapabilityClient,
        anchor: OpenProjectAnchor,
      ) => client.loginStart(anchor),
    },
    {
      operation: "login-status",
      session: "account",
      identity: { userId: "@bob:example.org", deviceId: "BOB_DEVICE" },
      invoke: (
        client: OpenProjectCapabilityClient,
        anchor: OpenProjectAnchor,
      ) => client.loginStatus(anchor),
    },
    {
      operation: "login-status",
      session: "device",
      identity: {
        userId: "@alice:example.org",
        deviceId: "ALICE_SECOND_DEVICE",
      },
      invoke: (
        client: OpenProjectCapabilityClient,
        anchor: OpenProjectAnchor,
      ) => client.loginStatus(anchor),
    },
  ])(
    "rejects $operation and cleans up after a $session change",
    async ({ invoke, identity }) => {
      const toDevice = new MockToDeviceApi();
      const profile = new MockProfile();
      const client = new OpenProjectCapabilityClient(toDevice, profile);
      const request = invoke(client, createAnchor());
      const requestId = getRequestId(toDevice);

      profile.update(identity);
      await expect(request).rejects.toThrow("Matrix account or device changed");
      expect(toDevice.listenerCount).toBe(0);
      expect(profile.listenerCount).toBe(0);

      deliverLoginResponse(
        toDevice,
        toDevice.sentMessages[0].type === HOOKSHOT_LOGIN_START_EVENT_TYPE
          ? HOOKSHOT_LOGIN_START_RESPONSE_EVENT_TYPE
          : HOOKSHOT_LOGIN_STATUS_RESPONSE_EVENT_TYPE,
        {
          v: 1,
          request_id: requestId,
          integration_id: "openproject",
          result: "connected",
        },
      );
      expect(toDevice.sendMessage).toHaveBeenCalledOnce();
    },
  );

  it("rejects login requests without a valid anchor or active session", async () => {
    const toDevice = new MockToDeviceApi();
    const invalidSessionClient = new OpenProjectCapabilityClient(
      toDevice,
      new MockProfile({ userId: "@alice:example.org" }),
    );
    await expect(
      invalidSessionClient.loginStart(createAnchor()),
    ).rejects.toThrow("No active Matrix user and device");

    const client = new OpenProjectCapabilityClient(toDevice, new MockProfile());
    await expect(
      client.loginStatus(createAnchor({ eventId: "invalid-event" })),
    ).rejects.toThrow("Invalid OpenProject anchor");
    expect(toDevice.onMessage).not.toHaveBeenCalled();
    expect(toDevice.sendMessage).not.toHaveBeenCalled();
  });
});
