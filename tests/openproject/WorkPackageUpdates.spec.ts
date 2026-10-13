import { describe, expect, it, vi } from "vitest";
import { AppserviceMock } from "../utils/AppserviceMock";
import { BridgeConfigMessaging } from "../../src/config/sections";
import { BridgeOpenProjectConfig } from "../../src/config/sections/OpenProject";
import { OpenProjectConnection } from "../../src/Connections/OpenProjectConnection";
import type { OpenProjectConnectionState } from "../../src/Connections/OpenProjectConnection";
import { workPackageToCacheState } from "../../src/openproject/State";
import type {
  OpenProjectAnchorState,
  OpenProjectWorkPackageCacheState,
} from "../../src/openproject/State";
import type { OpenProjectWorkPackage } from "../../src/openproject/Types";
import type { IBridgeStorageProvider } from "../../src/stores/StorageProvider";
import {
  OPENPROJECT_ANCHOR_EVENT_KIND,
  OPENPROJECT_EVENT_SCHEMA_VERSION,
} from "../../src/openproject/Schema";
import { formatWorkPackageFallback } from "../../src/openproject/Format";
import { BASE_URL, WORK_PACKAGE } from "./WorkPackageFixtures";

const ROOM_ID = "!openproject:example.test";

class RecordingStorage {
  public cachedState: OpenProjectWorkPackageCacheState | null = null;
  public anchorState: OpenProjectAnchorState | null = null;
  public readonly operations: string[] = [];

  public async getOpenProjectAnchorState() {
    this.operations.push("get-anchor");
    return this.anchorState;
  }

  public async setOpenProjectAnchorState(
    _connectionId: string,
    _workPackageId: number,
    state: OpenProjectAnchorState,
  ) {
    this.operations.push("set-anchor");
    this.anchorState = state;
  }

  public async getOpenProjectWorkPackageState() {
    this.operations.push("get");
    return this.cachedState;
  }

  public async setOpenProjectWorkPackageState(
    state: OpenProjectWorkPackageCacheState,
  ) {
    this.operations.push("set");
    this.cachedState = state;
  }
}

function createConnection(
  storage: RecordingStorage,
  events: OpenProjectConnectionState["events"] = ["work_package:updated"],
  tokenStore: ConstructorParameters<
    typeof OpenProjectConnection
  >[6] = undefined as never,
  anchors: OpenProjectConnectionState["anchors"] = [],
) {
  const appservice = AppserviceMock.create();
  const intent = appservice.getIntentForUserId("@openproject:example.test");
  const config = new BridgeOpenProjectConfig({
    baseUrl: BASE_URL.href,
    webhook: { secret: "secret" },
  });
  const connection = new OpenProjectConnection(
    ROOM_ID,
    appservice,
    intent,
    config,
    {
      url: `${BASE_URL}projects/1`,
      events,
      anchors,
    },
    "state-key",
    tokenStore,
    storage as unknown as IBridgeStorageProvider,
    new BridgeConfigMessaging(),
  );
  return { connection, intent };
}

function updatePayload(workPackage: OpenProjectWorkPackage) {
  return {
    action: "work_package:updated" as const,
    work_package: workPackage,
  };
}

function createPayload(workPackage: OpenProjectWorkPackage) {
  return {
    action: "work_package:created" as const,
    work_package: workPackage,
  };
}

describe("OpenProjectConnection work-package updates", () => {
  it.each([
    ["assigned", WORK_PACKAGE],
    [
      "unassigned",
      {
        ...WORK_PACKAGE,
        _embedded: { ...WORK_PACKAGE._embedded, assignee: undefined },
      },
    ],
  ] as const)(
    "sends a complete %s creation fallback as a versioned anchor",
    async (_label, workPackage) => {
      const storage = new RecordingStorage();
      const { connection, intent } = createConnection(
        storage,
        ["work_package:created"],
        undefined as never,
        ["work_package:created"],
      );

      await connection.onWorkPackageCreated(createPayload(workPackage));

      expect(intent.sentEvents).toHaveLength(1);
      expect(intent.sentEvents[0].content.body).toContain(
        "added to the timeline",
      );
      expect(intent.sentEvents[0].content.body).not.toContain("\n");
      expect(intent.sentEvents[0].content).toMatchObject({
        body: formatWorkPackageFallback(workPackage, BASE_URL),
        "org.matrix.matrix-hookshot.openproject.schema_version":
          OPENPROJECT_EVENT_SCHEMA_VERSION,
        "org.matrix.matrix-hookshot.openproject.event_kind":
          OPENPROJECT_ANCHOR_EVENT_KIND,
      });
      expect(storage.anchorState).toMatchObject({
        anchorEventId: "event_0",
        lockVersion: workPackage.lockVersion,
        lastContent: {
          body: formatWorkPackageFallback(workPackage, BASE_URL),
        },
      });
    },
  );

  it("does not create an anchor when automatic creation is disabled", async () => {
    const storage = new RecordingStorage();
    const { connection, intent } = createConnection(storage, [
      "work_package:created",
    ]);

    await connection.onWorkPackageCreated(createPayload(WORK_PACKAGE));

    expect(intent.sentEvents).toHaveLength(0);
    expect(storage.anchorState).toBeNull();
  });

  it("serializes duplicate creates and creates only one anchor", async () => {
    const storage = new RecordingStorage();
    const { connection, intent } = createConnection(
      storage,
      [],
      undefined as never,
      ["work_package:created"],
    );

    await Promise.all([
      connection.onWorkPackageCreated(createPayload(WORK_PACKAGE)),
      connection.onWorkPackageCreated(createPayload(WORK_PACKAGE)),
    ]);

    expect(intent.sentEvents).toHaveLength(1);
    expect(storage.anchorState?.anchorEventId).toBe("event_0");
  });

  it("revises an existing anchor for a newer created payload", async () => {
    const storage = new RecordingStorage();
    const { connection, intent } = createConnection(
      storage,
      [],
      undefined as never,
      ["work_package:created"],
    );
    const revisedWorkPackage = {
      ...WORK_PACKAGE,
      lockVersion: WORK_PACKAGE.lockVersion + 1,
      subject: "Revised title",
    };

    await connection.onWorkPackageCreated(createPayload(WORK_PACKAGE));
    await connection.onWorkPackageCreated(createPayload(revisedWorkPackage));

    expect(intent.sentEvents).toHaveLength(2);
    expect(intent.sentEvents[1].content["m.relates_to"]).toEqual({
      rel_type: "m.replace",
      event_id: "event_0",
    });
    expect(storage.anchorState).toMatchObject({
      anchorEventId: "event_0",
      lockVersion: revisedWorkPackage.lockVersion,
      lastContent: {
        "org.matrix.matrix-hookshot.openproject.work_package": {
          subject: revisedWorkPackage.subject,
        },
      },
    });
  });

  it.each([
    ["assigned", WORK_PACKAGE],
    [
      "unassigned",
      {
        ...WORK_PACKAGE,
        _embedded: { ...WORK_PACKAGE._embedded, assignee: undefined },
      },
    ],
  ] as const)(
    "sends the complete %s create-command fallback as a versioned anchor",
    async (_label, workPackage) => {
      const storage = new RecordingStorage();
      const openProjectClient = {
        getTypesInProject: vi
          .fn()
          .mockResolvedValue([workPackage._embedded.type]),
        createWorkPackage: vi.fn().mockResolvedValue(workPackage),
      };
      const tokenStore = {
        getOpenProjectForUser: vi.fn().mockResolvedValue(openProjectClient),
      } as unknown as ConstructorParameters<typeof OpenProjectConnection>[6];
      const { connection, intent } = createConnection(storage, [], tokenStore);

      await connection.commandCreateWorkPackage(
        "@alice:example.test",
        undefined,
        workPackage._embedded.type.name,
        workPackage.subject,
      );

      expect(intent.sentEvents).toHaveLength(1);
      expect(intent.sentEvents[0].content.body).toContain(
        "added to the timeline",
      );
      expect(intent.sentEvents[0].content.body).not.toContain("\n");
      expect(intent.sentEvents[0].content).toMatchObject({
        body: formatWorkPackageFallback(workPackage, BASE_URL),
        "org.matrix.matrix-hookshot.openproject.schema_version":
          OPENPROJECT_EVENT_SCHEMA_VERSION,
        "org.matrix.matrix-hookshot.openproject.event_kind":
          OPENPROJECT_ANCHOR_EVENT_KIND,
      });
    },
  );

  it("reads the previous state before writing the updated state", async () => {
    const storage = new RecordingStorage();
    storage.cachedState = workPackageToCacheState(WORK_PACKAGE);
    const { connection, intent } = createConnection(storage, [
      "work_package:subject_changed",
    ]);
    const updatedWorkPackage = {
      ...WORK_PACKAGE,
      subject: "Build the better bridge",
    };

    await connection.onWorkPackageUpdated(updatePayload(updatedWorkPackage));

    expect(storage.operations).toEqual(["get", "set"]);
    expect(intent.sentEvents).toHaveLength(1);
    expect(intent.sentEvents[0].content.body).toContain("updated the subject");
    expect(intent.sentEvents[0].content).not.toHaveProperty(
      "org.matrix.matrix-hookshot.openproject.schema_version",
    );
    expect(intent.sentEvents[0].content).not.toHaveProperty(
      "org.matrix.matrix-hookshot.openproject.event_kind",
    );
    expect(storage.cachedState).toEqual(
      workPackageToCacheState(updatedWorkPackage),
    );
  });

  it("refreshes the cache and sends no notification for a no-op update", async () => {
    const storage = new RecordingStorage();
    storage.cachedState = workPackageToCacheState(WORK_PACKAGE);
    const { connection, intent } = createConnection(storage);

    await connection.onWorkPackageUpdated(updatePayload(WORK_PACKAGE));

    expect(storage.operations).toEqual(["get", "set"]);
    expect(storage.cachedState).toEqual(workPackageToCacheState(WORK_PACKAGE));
    expect(intent.sentEvents).toHaveLength(0);
  });

  it("sends a generic update notification when no cached state exists", async () => {
    const storage = new RecordingStorage();
    const { connection, intent } = createConnection(storage);

    await connection.onWorkPackageUpdated(updatePayload(WORK_PACKAGE));

    expect(storage.operations).toEqual(["get", "set"]);
    expect(intent.sentEvents).toHaveLength(1);
    expect(intent.sentEvents[0].content.body).toContain(
      "**OpenProject Admin** updated work package",
    );
  });

  it("refreshes the cache without notifying for a filtered update", async () => {
    const storage = new RecordingStorage();
    storage.cachedState = workPackageToCacheState(WORK_PACKAGE);
    const { connection, intent } = createConnection(storage, []);
    const updatedWorkPackage = {
      ...WORK_PACKAGE,
      subject: "Build the better bridge",
    };

    await connection.onWorkPackageUpdated(updatePayload(updatedWorkPackage));

    expect(storage.operations).toEqual(["get", "set"]);
    expect(storage.cachedState).toEqual(
      workPackageToCacheState(updatedWorkPackage),
    );
    expect(intent.sentEvents).toHaveLength(0);
  });
});
