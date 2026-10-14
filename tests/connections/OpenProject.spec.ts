import { describe, expect, it, vi } from "vitest";
import type { Intent, StateEvent } from "matrix-bot-sdk";
import { ApiError, ErrCode } from "../../src/api";
import type { BridgeConfig } from "../../src/config/Config";
import { BridgeConfigMessaging } from "../../src/config/sections";
import { BridgeOpenProjectConfig } from "../../src/config/sections/OpenProject";
import {
  OpenProjectConnection,
  type OpenProjectEventsNames,
} from "../../src/Connections/OpenProjectConnection";
import type { InstantiateConnectionOpts } from "../../src/Connections/IConnection";
import type { UserTokenStore } from "../../src/tokens/UserTokenStore";
import { ConnectionManager } from "../../src/ConnectionManager";
import { createAuthenticatedProbeHandler } from "../../src/AuthenticatedProbeHandler";
import {
  OPENPROJECT_ANCHOR_EVENT_KIND,
  OPENPROJECT_EVENT_SCHEMA_VERSION,
} from "../../src/openproject/Schema";
import {
  HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
  type HookshotCapabilitiesProbeRequest,
} from "../../src/ToDeviceProtocol";
import { AppserviceMock } from "../utils/AppserviceMock";
import { BASE_URL } from "../openproject/WorkPackageFixtures";

const ROOM_ID = "!openproject:example.test";
const PROJECT_URL = `${BASE_URL}projects/1`;
const ALL_EVENTS: OpenProjectEventsNames[] = [
  "work_package:created",
  "work_package:updated",
  "work_package:assignee_changed",
  "work_package:description_changed",
  "work_package:duedate_changed",
  "work_package:workpercent_changed",
  "work_package:priority_changed",
  "work_package:responsible_changed",
  "work_package:subject_changed",
];

function createConnectionState(
  state: Record<string, unknown> = {},
  intentOverride?: Intent,
  storageOverride?: InstantiateConnectionOpts["storage"],
): OpenProjectConnection {
  const appservice = AppserviceMock.create();
  const intent =
    intentOverride ??
    appservice.getIntentForUserId("@openproject:example.test");
  const config = {
    openProject: new BridgeOpenProjectConfig({
      baseUrl: BASE_URL.href,
      webhook: { secret: "secret" },
    }),
    messaging: new BridgeConfigMessaging(),
  } as unknown as BridgeConfig;

  return OpenProjectConnection.createConnectionForState(
    ROOM_ID,
    {
      stateKey: "state-key",
      content: {
        url: PROJECT_URL,
        events: ["work_package:updated"],
        ...state,
      },
    } as unknown as StateEvent<Record<string, unknown>>,
    {
      as: appservice,
      intent,
      config,
      tokenStore: {} as UserTokenStore,
      commentProcessor: undefined as never,
      messageClient: undefined as never,
      storage: storageOverride ?? ({} as InstantiateConnectionOpts["storage"]),
    },
  );
}

function expectBadValue(state: Record<string, unknown>): void {
  try {
    createConnectionState(state);
    throw new Error("Expected OpenProject state validation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).errcode).toBe(ErrCode.BadValue);
  }
}

describe("OpenProjectConnection", () => {
  it("deletes all active anchors during connection cleanup", async () => {
    const storage = {
      deleteOpenProjectAnchorStates: vi.fn().mockResolvedValue(undefined),
    } as unknown as InstantiateConnectionOpts["storage"];
    const connection = createConnectionState({}, undefined, storage);

    await connection.cleanupTimelineAnchors();

    expect(storage.deleteOpenProjectAnchorStates).toHaveBeenCalledWith(
      connection.connectionId,
    );
  });

  it("preserves active anchors when room connections are rebuilt", async () => {
    const storage = {
      deleteOpenProjectAnchorStates: vi.fn().mockResolvedValue(undefined),
    } as unknown as InstantiateConnectionOpts["storage"];
    const connection = createConnectionState({}, undefined, storage);
    const manager = new ConnectionManager(
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      storage,
      undefined as never,
      undefined as never,
    );
    manager.push(connection);

    await manager.removeConnectionsForRoom(ROOM_ID);

    expect(storage.deleteOpenProjectAnchorStates).not.toHaveBeenCalled();
  });

  it("denies probes for a disabled connection even when anchor cleanup fails", async () => {
    let failCleanup!: (error: Error) => void;
    const cleanup = new Promise<void>((_resolve, reject) => {
      failCleanup = reject;
    });
    const storage = {
      deleteOpenProjectAnchorStates: vi.fn().mockReturnValue(cleanup),
    } as unknown as InstantiateConnectionOpts["storage"];
    const connection = createConnectionState({}, undefined, storage);
    const manager = new ConnectionManager(
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      storage,
      undefined as never,
      undefined as never,
    );
    manager.push(connection);

    const anchorEventId = "$active-anchor";
    const anchorContent = {
      "org.matrix.matrix-hookshot.openproject.schema_version":
        OPENPROJECT_EVENT_SCHEMA_VERSION,
      "org.matrix.matrix-hookshot.openproject.event_kind":
        OPENPROJECT_ANCHOR_EVENT_KIND,
      "org.matrix.matrix-hookshot.openproject.anchor_state": "active",
      "org.matrix.matrix-hookshot.openproject.project": { id: 1 },
      "org.matrix.matrix-hookshot.openproject.work_package": { id: 50 },
    };
    const getOpenProjectAnchorState = vi.fn().mockResolvedValue({
      anchorEventId,
      lockVersion: 1,
      lastContent: anchorContent,
    });
    const probe = createAuthenticatedProbeHandler({
      getAnchorEvent: vi.fn().mockResolvedValue({
        room_id: ROOM_ID,
        sender: connection.botUserId,
        content: anchorContent,
      }),
      getOpenProjectConnections: (projectId) =>
        manager.getConnectionsForOpenProject(projectId).map((candidate) => ({
          connectionId: candidate.connectionId,
          roomId: candidate.roomId,
          botUserId: candidate.botUserId,
        })),
      getOpenProjectAnchorState,
      assertRoomReadAccess: vi.fn().mockResolvedValue(undefined),
      getOpenProjectForUser: vi.fn().mockResolvedValue({}),
    });
    const request: HookshotCapabilitiesProbeRequest = {
      v: HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
      request_id: "request-1",
      requesting_device_id: "ELEMENTDEVICE",
      integration_id: "openproject",
      room_id: ROOM_ID,
      anchor_event_id: anchorEventId,
    };
    const context = {
      sender: "@alice:example.test",
      recipientBotUserId: connection.botUserId,
    };

    await expect(probe(request, context)).resolves.toEqual({
      result: "ok",
      connection: "connected",
    });

    const pendingPurge = manager.purgeConnection(
      ROOM_ID,
      connection.connectionId,
      false,
    );
    await vi.waitFor(() =>
      expect(storage.deleteOpenProjectAnchorStates).toHaveBeenCalledOnce(),
    );
    await expect(probe(request, context)).resolves.toEqual({
      result: "not_authorized",
    });
    expect(getOpenProjectAnchorState).toHaveBeenCalledTimes(1);

    failCleanup(new Error("Redis unavailable"));
    await expect(pendingPurge).rejects.toThrow("Redis unavailable");
    expect(manager.getConnectionById(ROOM_ID, connection.connectionId)).toBe(
      connection,
    );
    expect(manager.getConnectionsForOpenProject(1)).toEqual([]);
    await expect(probe(request, context)).resolves.toEqual({
      result: "not_authorized",
    });
  });

  it("uses the deployment-selected bot when provisioning", async () => {
    const appservice = AppserviceMock.create();
    const requestedIntent = appservice.getIntentForUserId(
      "@hookshot:example.test",
    );
    const selectedIntent = appservice.getIntentForUserId(
      "@hookshot_openproject:example.test",
    );
    const config = {
      openProject: new BridgeOpenProjectConfig({
        baseUrl: BASE_URL.href,
        webhook: { secret: "secret" },
      }),
      messaging: new BridgeConfigMessaging(),
    } as unknown as BridgeConfig;
    const tokenStore = {
      getOpenProjectForUser: async () => ({
        getProject: async () => ({}),
      }),
    } as unknown as UserTokenStore;

    const result = await OpenProjectConnection.provisionConnection(
      ROOM_ID,
      "@alice:example.test",
      { url: PROJECT_URL },
      {
        as: appservice,
        intent: requestedIntent,
        config,
        tokenStore,
        commentProcessor: undefined as never,
        messageClient: undefined as never,
        storage: {} as InstantiateConnectionOpts["storage"],
        getAllConnectionsOfType: () => [],
        getIntegrationBotForService: () => ({
          userId: selectedIntent.userId,
          intent: selectedIntent,
        }),
        isBotUserInRoom: () => true,
      },
    );

    expect(result.connection.botUserId).toBe(selectedIntent.userId);
    expect(requestedIntent.sentEvents).toHaveLength(0);
    expect(result.connection.getProvisionerDetails().config.anchors).toEqual(
      [],
    );
  });

  it("rejects provisioning when the selected bot is not joined", async () => {
    const appservice = AppserviceMock.create();
    const selectedIntent = appservice.getIntentForUserId(
      "@hookshot_openproject:example.test",
    );
    const config = {
      openProject: new BridgeOpenProjectConfig({
        baseUrl: BASE_URL.href,
        webhook: { secret: "secret" },
      }),
      messaging: new BridgeConfigMessaging(),
    } as unknown as BridgeConfig;

    await expect(
      OpenProjectConnection.provisionConnection(
        ROOM_ID,
        "@alice:example.test",
        { url: PROJECT_URL },
        {
          as: appservice,
          intent: selectedIntent,
          config,
          tokenStore: {} as UserTokenStore,
          commentProcessor: undefined as never,
          messageClient: undefined as never,
          storage: {} as InstantiateConnectionOpts["storage"],
          getAllConnectionsOfType: () => [],
          getIntegrationBotForService: () => ({
            userId: selectedIntent.userId,
            intent: selectedIntent,
          }),
          isBotUserInRoom: () => false,
        },
      ),
    ).rejects.toMatchObject({ errcode: ErrCode.NotInRoom });
  });

  describe("state validation", () => {
    it("accepts a complete state config", () => {
      const connection = createConnectionState({
        events: ALL_EVENTS,
        anchors: ["work_package:created"],
        commandPrefix: "!openproject",
        priority: 5,
      });

      expect(connection.projectId).toBe(1);
      expect(connection.priority).toBe(5);
      expect(connection.getProvisionerDetails().config.anchors).toEqual([
        "work_package:created",
      ]);
      for (const event of ALL_EVENTS) {
        expect(connection.isInterestedInHookEvent(event)).toBe(true);
      }
    });

    it("defaults events when they are omitted", () => {
      const connection = createConnectionState({ events: undefined });

      expect(connection.isInterestedInHookEvent("work_package:created")).toBe(
        true,
      );
      expect(connection.isInterestedInHookEvent("work_package:updated")).toBe(
        true,
      );
      expect(
        connection.isInterestedInHookEvent("work_package:subject_changed"),
      ).toBe(false);
    });

    it("normalizes legacy connections without anchors to an empty list", () => {
      const connection = createConnectionState({ anchors: undefined });

      expect(connection.getProvisionerDetails().config.anchors).toEqual([]);
    });

    it.each([
      ["a missing URL", { url: undefined }],
      ["a non-string URL", { url: 123 }],
      ["an invalid URL", { url: "not a URL" }],
      [
        "a URL with a different origin",
        { url: "https://other.example/projects/1" },
      ],
    ])("rejects %s", (_description, state) => {
      expectBadValue(state);
    });

    it("rejects a URL without a project ID", () => {
      expect(() =>
        createConnectionState({ url: `${BASE_URL}not-a-project` }),
      ).toThrow("URL for project doesnt contain a project ID");
    });

    it.each([
      ["a non-string command prefix", { commandPrefix: 123 }],
      ["a command prefix that is too short", { commandPrefix: "!" }],
      [
        "a command prefix that is too long",
        { commandPrefix: "!" + "a".repeat(48) },
      ],
    ])("rejects %s", (_description, state) => {
      expectBadValue(state);
    });

    it("rejects an unsupported event name", () => {
      expectBadValue({ events: ["work_package:not_real"] });
    });

    it.each([
      ["an unsupported anchor event", ["work_package:updated"]],
      ["a non-array anchor value", "work_package:created"],
      ["a null anchor value", null],
    ])("rejects %s", (_description, anchors) => {
      expectBadValue({ anchors });
    });
  });

  it("persists anchors when editing a connection", async () => {
    const appservice = AppserviceMock.create();
    const intent = appservice.getIntentForUserId("@openproject:example.test");
    const connection = createConnectionState({ anchors: [] }, intent);
    const sendStateEventSpy = vi
      .spyOn(intent.underlyingClient, "sendStateEvent")
      .mockResolvedValue("$state");

    await connection.provisionerUpdateConfig("@alice:example.test", {
      anchors: ["work_package:created"],
    });

    expect(sendStateEventSpy).toHaveBeenCalledWith(
      ROOM_ID,
      OpenProjectConnection.CanonicalEventType,
      "state-key",
      expect.objectContaining({ anchors: ["work_package:created"] }),
    );
    expect(connection.getProvisionerDetails().config.anchors).toEqual([
      "work_package:created",
    ]);
    sendStateEventSpy.mockRestore();
  });
});
