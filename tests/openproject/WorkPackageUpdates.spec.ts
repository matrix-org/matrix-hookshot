import { describe, expect, it, vi } from "vitest";
import { AppserviceMock } from "../utils/AppserviceMock";
import { BridgeConfigMessaging } from "../../src/config/sections";
import { BridgeOpenProjectConfig } from "../../src/config/sections/OpenProject";
import { OpenProjectConnection } from "../../src/Connections/OpenProjectConnection";
import type { OpenProjectConnectionState } from "../../src/Connections/OpenProjectConnection";
import { workPackageToCacheState } from "../../src/openproject/State";
import type { OpenProjectWorkPackageCacheState } from "../../src/openproject/State";
import type { OpenProjectWorkPackage } from "../../src/openproject/Types";
import type { IBridgeStorageProvider } from "../../src/stores/StorageProvider";
import {
  OPENPROJECT_ANCHOR_EVENT_KIND,
  OPENPROJECT_EVENT_SCHEMA_VERSION,
} from "../../src/openproject/Schema";
import { BASE_URL, WORK_PACKAGE } from "./WorkPackageFixtures";

const ROOM_ID = "!openproject:example.test";

class RecordingStorage {
  public cachedState: OpenProjectWorkPackageCacheState | null = null;
  public readonly operations: string[] = [];

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
  it("sends a newly created work package as a versioned anchor", async () => {
    const storage = new RecordingStorage();
    const { connection, intent } = createConnection(storage, [
      "work_package:created",
    ]);

    await connection.onWorkPackageCreated(createPayload(WORK_PACKAGE));

    expect(intent.sentEvents).toHaveLength(1);
    expect(intent.sentEvents[0].content).toMatchObject({
      "org.matrix.matrix-hookshot.openproject.schema_version":
        OPENPROJECT_EVENT_SCHEMA_VERSION,
      "org.matrix.matrix-hookshot.openproject.event_kind":
        OPENPROJECT_ANCHOR_EVENT_KIND,
    });
  });

  it("sends the command-created fallback as a versioned anchor", async () => {
    const storage = new RecordingStorage();
    const openProjectClient = {
      getTypesInProject: vi
        .fn()
        .mockResolvedValue([WORK_PACKAGE._embedded.type]),
      createWorkPackage: vi.fn().mockResolvedValue(WORK_PACKAGE),
    };
    const tokenStore = {
      getOpenProjectForUser: vi.fn().mockResolvedValue(openProjectClient),
    } as unknown as ConstructorParameters<typeof OpenProjectConnection>[6];
    const { connection, intent } = createConnection(storage, [], tokenStore);

    await connection.commandCreateWorkPackage(
      "@alice:example.test",
      undefined,
      WORK_PACKAGE._embedded.type.name,
      WORK_PACKAGE.subject,
    );

    expect(intent.sentEvents).toHaveLength(1);
    expect(intent.sentEvents[0].content).toMatchObject({
      "org.matrix.matrix-hookshot.openproject.schema_version":
        OPENPROJECT_EVENT_SCHEMA_VERSION,
      "org.matrix.matrix-hookshot.openproject.event_kind":
        OPENPROJECT_ANCHOR_EVENT_KIND,
    });
  });

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
