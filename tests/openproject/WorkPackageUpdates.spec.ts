import { describe, expect, it, vi } from "vitest";
import { MatrixError } from "matrix-bot-sdk";
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
  public activityState: OpenProjectWorkPackageCacheState | null = null;
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

  public async deleteOpenProjectAnchorState() {
    this.operations.push("delete-anchor");
    this.anchorState = null;
  }

  public async getOpenProjectActivityState() {
    this.operations.push("get-activity");
    return this.activityState;
  }

  public async setOpenProjectActivityState(
    _connectionId: string,
    _workPackageId: number,
    state: OpenProjectWorkPackageCacheState,
  ) {
    this.operations.push("set-activity");
    this.activityState = state;
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

      expect(intent.sentEvents).toHaveLength(2);
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
      expect(intent.sentEvents[1].content.body).toContain(
        "created [#50 Build the bridge]",
      );
      expect(
        intent.sentEvents[1].content[
          "org.matrix.matrix-hookshot.openproject.event_kind"
        ],
      ).toBe("activity");
      expect(
        intent.sentEvents[1].content[
          "org.matrix.matrix-hookshot.openproject.anchor_event_id"
        ],
      ).toBe("event_0");
    },
  );

  it("does not create an anchor when automatic creation is disabled", async () => {
    const storage = new RecordingStorage();
    const { connection, intent } = createConnection(storage, [
      "work_package:created",
    ]);

    await connection.onWorkPackageCreated(createPayload(WORK_PACKAGE));

    expect(intent.sentEvents).toHaveLength(1);
    expect(intent.sentEvents[0].content.body).toContain(
      "created [#50 Build the bridge]",
    );
    expect(storage.anchorState).toBeNull();
  });

  it.each([
    [false, false, 0, 0],
    [false, true, 0, 1],
    [true, false, 1, 0],
    [true, true, 1, 1],
  ])(
    "keeps automatic creation %s independent from created activity %s",
    async (
      automaticCreation,
      createdActivity,
      expectedAnchors,
      expectedActivity,
    ) => {
      const storage = new RecordingStorage();
      const { connection, intent } = createConnection(
        storage,
        createdActivity ? ["work_package:created"] : [],
        undefined as never,
        automaticCreation ? ["work_package:created"] : [],
      );

      await connection.onWorkPackageCreated(createPayload(WORK_PACKAGE));

      const sentEvents = intent.sentEvents as Array<{
        content: { body: string; [key: string]: unknown };
      }>;
      const anchors = sentEvents.filter(
        (event) =>
          event.content["org.matrix.matrix-hookshot.openproject.event_kind"] ===
          OPENPROJECT_ANCHOR_EVENT_KIND,
      );
      const activity = sentEvents.filter(
        (event) =>
          event.content["org.matrix.matrix-hookshot.openproject.event_kind"] ===
          "activity",
      );
      expect(anchors).toHaveLength(expectedAnchors);
      expect(activity).toHaveLength(expectedActivity);
      expect(storage.anchorState !== null).toBe(automaticCreation);
    },
  );

  it("sends created activity when automatic anchor creation fails", async () => {
    const storage = new RecordingStorage();
    const { connection, intent } = createConnection(
      storage,
      ["work_package:created"],
      undefined as never,
      ["work_package:created"],
    );
    vi.spyOn(intent.underlyingClient, "sendMessage").mockRejectedValueOnce(
      new Error("Matrix unavailable"),
    );

    await connection.onWorkPackageCreated(createPayload(WORK_PACKAGE));

    expect(intent.sentEvents).toHaveLength(1);
    expect(intent.sentEvents[0].content.body).toContain(
      "created [#50 Build the bridge]",
    );
    expect(
      intent.sentEvents[0].content[
        "org.matrix.matrix-hookshot.openproject.event_kind"
      ],
    ).toBe("activity");
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

  it("revises an existing anchor after automatic creation is disabled", async () => {
    const storage = new RecordingStorage();
    const { connection: initialConnection } = createConnection(
      storage,
      [],
      undefined as never,
      ["work_package:created"],
    );
    await initialConnection.onWorkPackageCreated(createPayload(WORK_PACKAGE));

    const { connection, intent } = createConnection(storage, []);
    const revisedWorkPackage = {
      ...WORK_PACKAGE,
      lockVersion: WORK_PACKAGE.lockVersion + 1,
      subject: "Revised title",
    };

    await connection.onWorkPackageCreated(createPayload(revisedWorkPackage));
    await connection.onWorkPackageCreated(createPayload(revisedWorkPackage));

    expect(intent.sentEvents).toHaveLength(1);
    expect(intent.sentEvents[0].content["m.relates_to"]).toEqual({
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

  it("replaces only a newer update on the original active anchor", async () => {
    const storage = new RecordingStorage();
    const { connection, intent } = createConnection(
      storage,
      [],
      undefined as never,
      ["work_package:created"],
    );
    const updatedWorkPackage = {
      ...WORK_PACKAGE,
      lockVersion: WORK_PACKAGE.lockVersion + 1,
      subject: "Updated title",
    };

    await connection.onWorkPackageCreated(createPayload(WORK_PACKAGE));
    await connection.onWorkPackageUpdated(updatePayload(updatedWorkPackage));

    expect(intent.sentEvents).toHaveLength(2);
    expect(intent.sentEvents[1].content["m.relates_to"]).toEqual({
      rel_type: "m.replace",
      event_id: "event_0",
    });
    expect(intent.sentEvents[1].content["m.new_content"]).toMatchObject({
      body: formatWorkPackageFallback(updatedWorkPackage, BASE_URL),
      "org.matrix.matrix-hookshot.openproject.work_package": {
        id: updatedWorkPackage.id,
        subject: updatedWorkPackage.subject,
      },
      "org.matrix.matrix-hookshot.openproject.anchor_state": "active",
    });
    expect(storage.anchorState).toMatchObject({
      anchorEventId: "event_0",
      lockVersion: updatedWorkPackage.lockVersion,
      lastContent: intent.sentEvents[1].content["m.new_content"],
    });
  });

  it("keeps the newest anchor revision when updates arrive out of order", async () => {
    const storage = new RecordingStorage();
    const { connection, intent } = createConnection(
      storage,
      [],
      undefined as never,
      ["work_package:created"],
    );
    const newestUpdate = {
      ...WORK_PACKAGE,
      lockVersion: WORK_PACKAGE.lockVersion + 2,
      subject: "Newest title",
    };
    const lateOlderUpdate = {
      ...WORK_PACKAGE,
      lockVersion: WORK_PACKAGE.lockVersion + 1,
      subject: "Older title delivered late",
    };

    await connection.onWorkPackageCreated(createPayload(WORK_PACKAGE));
    await Promise.all([
      connection.onWorkPackageUpdated(updatePayload(newestUpdate)),
      connection.onWorkPackageUpdated(updatePayload(lateOlderUpdate)),
    ]);

    expect(intent.sentEvents).toHaveLength(2);
    expect(storage.anchorState).toMatchObject({
      anchorEventId: "event_0",
      lockVersion: newestUpdate.lockVersion,
      lastContent: {
        "org.matrix.matrix-hookshot.openproject.work_package": {
          subject: newestUpdate.subject,
        },
      },
    });
  });

  it("replaces a persisted anchor after the connection is reconstructed", async () => {
    const storage = new RecordingStorage();
    const original = createConnection(storage, [], undefined as never, [
      "work_package:created",
    ]);
    await original.connection.onWorkPackageCreated(createPayload(WORK_PACKAGE));

    const restarted = createConnection(storage, []);
    const updatedWorkPackage = {
      ...WORK_PACKAGE,
      lockVersion: WORK_PACKAGE.lockVersion + 1,
      subject: "Updated after reconstruction",
    };
    await restarted.connection.onWorkPackageUpdated(
      updatePayload(updatedWorkPackage),
    );

    expect(restarted.intent.sentEvents).toHaveLength(1);
    expect(restarted.intent.sentEvents[0].content["m.relates_to"]).toEqual({
      rel_type: "m.replace",
      event_id: "event_0",
    });
    expect(storage.anchorState?.lockVersion).toBe(
      updatedWorkPackage.lockVersion,
    );
  });

  it.each([
    ["duplicate", WORK_PACKAGE.lockVersion],
    ["older", WORK_PACKAGE.lockVersion - 1],
  ])(
    "does not replace an anchor for a %s update",
    async (_label, lockVersion) => {
      const storage = new RecordingStorage();
      const { connection, intent } = createConnection(
        storage,
        [],
        undefined as never,
        ["work_package:created"],
      );
      const staleWorkPackage = {
        ...WORK_PACKAGE,
        lockVersion,
        subject: "Stale title",
      };

      await connection.onWorkPackageCreated(createPayload(WORK_PACKAGE));
      await connection.onWorkPackageUpdated(updatePayload(staleWorkPackage));

      expect(intent.sentEvents).toHaveLength(1);
      expect(storage.anchorState?.lockVersion).toBe(WORK_PACKAGE.lockVersion);
    },
  );

  it("does not create an anchor for an update without an active record", async () => {
    const storage = new RecordingStorage();
    storage.activityState = workPackageToCacheState(WORK_PACKAGE);
    const { connection, intent } = createConnection(storage, [
      "work_package:subject_changed",
    ]);
    const updatedWorkPackage = {
      ...WORK_PACKAGE,
      lockVersion: WORK_PACKAGE.lockVersion + 1,
      subject: "Activity without an anchor",
    };

    await connection.onWorkPackageUpdated(updatePayload(updatedWorkPackage));

    expect(intent.sentEvents).toHaveLength(1);
    expect(intent.sentEvents[0].content).not.toHaveProperty("m.relates_to");
    expect(storage.anchorState).toBeNull();
  });

  it("retains anchor state after a transient send failure and still sends activity", async () => {
    const storage = new RecordingStorage();
    const { connection, intent } = createConnection(
      storage,
      ["work_package:subject_changed"],
      undefined as never,
      ["work_package:created"],
    );
    const updatedWorkPackage = {
      ...WORK_PACKAGE,
      lockVersion: WORK_PACKAGE.lockVersion + 1,
      subject: "Updated with a transient failure",
    };
    await connection.onWorkPackageCreated(createPayload(WORK_PACKAGE));
    const storedAnchor = storage.anchorState;
    vi.spyOn(intent.underlyingClient, "sendMessage").mockRejectedValueOnce(
      new Error("temporary Matrix failure"),
    );

    await connection.onWorkPackageUpdated(updatePayload(updatedWorkPackage));

    expect(storage.anchorState).toEqual(storedAnchor);
    expect(intent.sentEvents).toHaveLength(2);
    expect(intent.sentEvents[1].content.body).toContain("updated the subject");
    expect(intent.sentEvents[1].content).not.toHaveProperty("m.relates_to");
  });

  it("deletes an anchor after a definitive missing-anchor failure", async () => {
    const storage = new RecordingStorage();
    const { connection, intent } = createConnection(
      storage,
      ["work_package:subject_changed"],
      undefined as never,
      ["work_package:created"],
    );
    const updatedWorkPackage = {
      ...WORK_PACKAGE,
      lockVersion: WORK_PACKAGE.lockVersion + 1,
      subject: "Updated after the anchor was removed",
    };
    await connection.onWorkPackageCreated(createPayload(WORK_PACKAGE));
    vi.spyOn(intent.underlyingClient, "sendMessage").mockRejectedValueOnce(
      new MatrixError(
        { errcode: "M_NOT_FOUND", error: "Anchor not found" },
        404,
        {},
      ),
    );

    await connection.onWorkPackageUpdated(updatePayload(updatedWorkPackage));

    expect(storage.anchorState).toBeNull();
    expect(storage.operations).toContain("delete-anchor");
    expect(intent.sentEvents).toHaveLength(2);
    expect(intent.sentEvents[1].content.body).toContain("updated the subject");
  });

  it("adds a fetched work package and persists the sent anchor", async () => {
    const storage = new RecordingStorage();
    const openProjectClient = {
      getWorkPackage: vi.fn().mockResolvedValue(WORK_PACKAGE),
    };
    const tokenStore = {
      getOpenProjectForUser: vi.fn().mockResolvedValue(openProjectClient),
    } as unknown as ConstructorParameters<typeof OpenProjectConnection>[6];
    const { connection, intent } = createConnection(storage, [], tokenStore);

    await connection.commandTimelineAdd(
      "@alice:example.test",
      String(WORK_PACKAGE.id),
    );

    expect(openProjectClient.getWorkPackage).toHaveBeenCalledWith(
      WORK_PACKAGE.id,
    );
    expect(intent.sentEvents).toHaveLength(1);
    expect(intent.sentEvents[0].content).toMatchObject({
      body: formatWorkPackageFallback(WORK_PACKAGE, BASE_URL),
      "org.matrix.matrix-hookshot.openproject.anchor_state": "active",
    });
    expect(storage.anchorState).toMatchObject({
      anchorEventId: "event_0",
      lockVersion: WORK_PACKAGE.lockVersion,
    });
  });

  it("returns successfully without sending when the package is already active", async () => {
    const storage = new RecordingStorage();
    const openProjectClient = {
      getWorkPackage: vi.fn().mockResolvedValue(WORK_PACKAGE),
    };
    const tokenStore = {
      getOpenProjectForUser: vi.fn().mockResolvedValue(openProjectClient),
    } as unknown as ConstructorParameters<typeof OpenProjectConnection>[6];
    const { connection, intent } = createConnection(storage, [], tokenStore, [
      "work_package:created",
    ]);
    await connection.onWorkPackageCreated(createPayload(WORK_PACKAGE));

    await connection.commandTimelineAdd(
      "@alice:example.test",
      String(WORK_PACKAGE.id),
    );

    expect(intent.sentEvents).toHaveLength(1);
  });

  it("rejects a work package from another project", async () => {
    const storage = new RecordingStorage();
    const otherProject = {
      ...WORK_PACKAGE,
      _embedded: {
        ...WORK_PACKAGE._embedded,
        project: { ...WORK_PACKAGE._embedded.project, id: 2 },
      },
    };
    const openProjectClient = {
      getWorkPackage: vi.fn().mockResolvedValue(otherProject),
    };
    const tokenStore = {
      getOpenProjectForUser: vi.fn().mockResolvedValue(openProjectClient),
    } as unknown as ConstructorParameters<typeof OpenProjectConnection>[6];
    const { connection, intent } = createConnection(storage, [], tokenStore);

    await expect(
      connection.commandTimelineAdd(
        "@alice:example.test",
        String(WORK_PACKAGE.id),
      ),
    ).rejects.toThrow("another project");

    expect(intent.sentEvents).toHaveLength(0);
    expect(storage.anchorState).toBeNull();
  });

  it("requires the sender's OpenProject OAuth connection", async () => {
    const storage = new RecordingStorage();
    const tokenStore = {
      getOpenProjectForUser: vi.fn().mockResolvedValue(null),
    } as unknown as ConstructorParameters<typeof OpenProjectConnection>[6];
    const { connection } = createConnection(storage, [], tokenStore);

    await expect(
      connection.commandTimelineAdd(
        "@alice:example.test",
        String(WORK_PACKAGE.id),
      ),
    ).rejects.toThrow("not logged in");
  });

  it("does not send an anchor when fetching the package fails", async () => {
    const storage = new RecordingStorage();
    const openProjectClient = {
      getWorkPackage: vi.fn().mockRejectedValue(new Error("OpenProject down")),
    };
    const tokenStore = {
      getOpenProjectForUser: vi.fn().mockResolvedValue(openProjectClient),
    } as unknown as ConstructorParameters<typeof OpenProjectConnection>[6];
    const { connection, intent } = createConnection(storage, [], tokenStore);

    await expect(
      connection.commandTimelineAdd(
        "@alice:example.test",
        String(WORK_PACKAGE.id),
      ),
    ).rejects.toThrow("OpenProject down");

    expect(intent.sentEvents).toHaveLength(0);
    expect(storage.anchorState).toBeNull();
  });

  it("serializes concurrent timeline adds", async () => {
    const storage = new RecordingStorage();
    const openProjectClient = {
      getWorkPackage: vi.fn().mockResolvedValue(WORK_PACKAGE),
    };
    const tokenStore = {
      getOpenProjectForUser: vi.fn().mockResolvedValue(openProjectClient),
    } as unknown as ConstructorParameters<typeof OpenProjectConnection>[6];
    const { connection, intent } = createConnection(storage, [], tokenStore);

    await Promise.all([
      connection.commandTimelineAdd(
        "@alice:example.test",
        String(WORK_PACKAGE.id),
      ),
      connection.commandTimelineAdd(
        "@alice:example.test",
        String(WORK_PACKAGE.id),
      ),
    ]);

    expect(openProjectClient.getWorkPackage).toHaveBeenCalledTimes(2);
    expect(intent.sentEvents).toHaveLength(1);
    expect(storage.anchorState?.anchorEventId).toBe("event_0");
  });

  it.each(["0", "-1", "1.5", "9007199254740992"])(
    "rejects invalid work package ID %s",
    async (workPackageId) => {
      const storage = new RecordingStorage();
      const { connection } = createConnection(storage);

      await expect(
        connection.commandTimelineAdd("@alice:example.test", workPackageId),
      ).rejects.toThrow("Invalid work package ID");
    },
  );

  it("removes an active anchor with complete inactive content", async () => {
    const storage = new RecordingStorage();
    const { connection, intent } = createConnection(
      storage,
      [],
      undefined as never,
      ["work_package:created"],
    );
    await connection.onWorkPackageCreated(createPayload(WORK_PACKAGE));
    const originalSnapshotId =
      intent.sentEvents[0].content[
        "org.matrix.matrix-hookshot.openproject.snapshot_id"
      ];

    await connection.commandTimelineRemove(String(WORK_PACKAGE.id));

    expect(intent.sentEvents).toHaveLength(2);
    expect(intent.sentEvents[1].content["m.relates_to"]).toEqual({
      rel_type: "m.replace",
      event_id: "event_0",
    });
    const inactiveContent = intent.sentEvents[1].content[
      "m.new_content"
    ] as Record<string, unknown>;
    expect(inactiveContent).toMatchObject({
      "org.matrix.matrix-hookshot.openproject.anchor_state": "inactive",
      "org.matrix.matrix-hookshot.openproject.work_package": {
        id: WORK_PACKAGE.id,
        subject: WORK_PACKAGE.subject,
      },
    });
    expect(
      inactiveContent["org.matrix.matrix-hookshot.openproject.snapshot_id"],
    ).not.toBe(originalSnapshotId);
    expect(storage.anchorState).toBeNull();
  });

  it("succeeds idempotently when no active anchor exists", async () => {
    const storage = new RecordingStorage();
    const tokenStore = {
      getOpenProjectForUser: vi.fn(),
    } as unknown as ConstructorParameters<typeof OpenProjectConnection>[6];
    const { connection, intent } = createConnection(storage, [], tokenStore);

    await connection.commandTimelineRemove(String(WORK_PACKAGE.id));

    expect(tokenStore.getOpenProjectForUser).not.toHaveBeenCalled();
    expect(intent.sentEvents).toHaveLength(0);
  });

  it("keeps the active record if the inactive replacement send fails", async () => {
    const storage = new RecordingStorage();
    const { connection, intent } = createConnection(
      storage,
      [],
      undefined as never,
      ["work_package:created"],
    );
    await connection.onWorkPackageCreated(createPayload(WORK_PACKAGE));
    const storedAnchor = storage.anchorState;
    vi.spyOn(intent.underlyingClient, "sendMessage").mockRejectedValueOnce(
      new Error("Matrix unavailable"),
    );

    await expect(
      connection.commandTimelineRemove(String(WORK_PACKAGE.id)),
    ).rejects.toThrow("Matrix unavailable");

    expect(storage.anchorState).toEqual(storedAnchor);
    expect(intent.sentEvents).toHaveLength(1);
  });

  it("removes anchors with nullable optional content from OpenProject", async () => {
    const storage = new RecordingStorage();
    const { connection, intent } = createConnection(
      storage,
      [],
      undefined as never,
      ["work_package:created"],
    );
    await connection.onWorkPackageCreated(createPayload(WORK_PACKAGE));
    const activeState = storage.anchorState!;
    const activeWorkPackage =
      activeState.lastContent[
        "org.matrix.matrix-hookshot.openproject.work_package"
      ];
    storage.anchorState = {
      ...activeState,
      lastContent: {
        ...activeState.lastContent,
        "org.matrix.matrix-hookshot.openproject.work_package": {
          ...activeWorkPackage,
          assignee: null,
          dueDate: undefined,
          date: undefined,
          deadline: undefined,
        },
      } as unknown as OpenProjectAnchorState["lastContent"],
    };

    await connection.commandTimelineRemove(String(WORK_PACKAGE.id));

    const inactiveContent = intent.sentEvents[1].content[
      "m.new_content"
    ] as Record<string, unknown>;
    const inactiveWorkPackage = inactiveContent[
      "org.matrix.matrix-hookshot.openproject.work_package"
    ] as Record<string, unknown>;
    expect(inactiveWorkPackage.assignee).toBeUndefined();
    expect(inactiveWorkPackage.dueDate).toBeNull();
    expect(inactiveWorkPackage.date).toBeNull();
    expect(inactiveWorkPackage.deadline).toBeNull();
    expect(storage.anchorState).toBeNull();
  });

  it("rejects malformed stored content without sending or deleting it", async () => {
    const storage = new RecordingStorage();
    const { connection, intent } = createConnection(
      storage,
      [],
      undefined as never,
      ["work_package:created"],
    );
    await connection.onWorkPackageCreated(createPayload(WORK_PACKAGE));
    storage.anchorState = {
      ...storage.anchorState!,
      lastContent: {} as OpenProjectAnchorState["lastContent"],
    };
    const malformedState = storage.anchorState;

    await expect(
      connection.commandTimelineRemove(String(WORK_PACKAGE.id)),
    ).rejects.toThrow("Invalid stored timeline anchor");

    expect(storage.anchorState).toEqual(malformedState);
    expect(intent.sentEvents).toHaveLength(1);
  });

  it("serializes concurrent timeline removals", async () => {
    const storage = new RecordingStorage();
    const { connection, intent } = createConnection(
      storage,
      [],
      undefined as never,
      ["work_package:created"],
    );
    await connection.onWorkPackageCreated(createPayload(WORK_PACKAGE));

    await Promise.all([
      connection.commandTimelineRemove(String(WORK_PACKAGE.id)),
      connection.commandTimelineRemove(String(WORK_PACKAGE.id)),
    ]);

    expect(intent.sentEvents).toHaveLength(2);
    expect(storage.anchorState).toBeNull();
  });

  it("serializes removal before a later update without recreating the anchor", async () => {
    const storage = new RecordingStorage();
    const { connection, intent } = createConnection(
      storage,
      [],
      undefined as never,
      ["work_package:created"],
    );
    const updatedWorkPackage = {
      ...WORK_PACKAGE,
      lockVersion: WORK_PACKAGE.lockVersion + 1,
      subject: "Updated after removal",
    };
    await connection.onWorkPackageCreated(createPayload(WORK_PACKAGE));

    await Promise.all([
      connection.commandTimelineRemove(String(WORK_PACKAGE.id)),
      connection.onWorkPackageUpdated(updatePayload(updatedWorkPackage)),
    ]);

    expect(intent.sentEvents).toHaveLength(2);
    expect(intent.sentEvents[1].content["m.new_content"]).toMatchObject({
      "org.matrix.matrix-hookshot.openproject.anchor_state": "inactive",
    });
    expect(storage.anchorState).toBeNull();
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
    "does not send a standalone %s create-command card",
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

      expect(intent.sentEvents).toHaveLength(0);
      expect(storage.activityState).toBeNull();
    },
  );

  it("does not send a standalone card when closing a work package", async () => {
    const storage = new RecordingStorage();
    const openProjectClient = {
      getWorkPackage: vi.fn().mockResolvedValue(WORK_PACKAGE),
      getStatuses: vi.fn().mockResolvedValue([
        {
          name: "Closed",
          isClosed: true,
          _links: { self: { href: "/statuses/5" } },
        },
      ]),
      updateWorkPackage: vi.fn().mockResolvedValue(WORK_PACKAGE),
      addWorkPackageComment: vi.fn(),
    };
    const tokenStore = {
      getOpenProjectForUser: vi.fn().mockResolvedValue(openProjectClient),
    } as unknown as ConstructorParameters<typeof OpenProjectConnection>[6];
    const { connection, intent } = createConnection(storage, [], tokenStore);

    await connection.commandCloseWorkPackage(
      "@alice:example.test",
      undefined,
      String(WORK_PACKAGE.id),
    );

    expect(openProjectClient.getWorkPackage).toHaveBeenCalledTimes(1);
    expect(openProjectClient.updateWorkPackage).toHaveBeenCalledWith(
      WORK_PACKAGE.id,
      WORK_PACKAGE.lockVersion,
      { _links: { status: { href: "/statuses/5" } } },
    );
    expect(intent.sentEvents).toHaveLength(0);
  });

  it("uses the fetched revision when setting a work-package priority", async () => {
    const storage = new RecordingStorage();
    const workPackage = { ...WORK_PACKAGE, lockVersion: 7 };
    const priority = {
      name: "High",
      _links: { self: { href: "/api/v3/priorities/9" } },
    };
    const openProjectClient = {
      getPriorities: vi.fn().mockResolvedValue([priority]),
      getWorkPackage: vi.fn().mockResolvedValue(workPackage),
      updateWorkPackage: vi.fn().mockResolvedValue(workPackage),
    };
    const tokenStore = {
      getOpenProjectForUser: vi.fn().mockResolvedValue(openProjectClient),
    } as unknown as ConstructorParameters<typeof OpenProjectConnection>[6];
    const { connection } = createConnection(storage, [], tokenStore);

    await connection.commandSetPriority(
      "@alice:example.test",
      undefined,
      String(workPackage.id),
      priority.name,
    );

    expect(openProjectClient.getWorkPackage).toHaveBeenCalledTimes(1);
    expect(openProjectClient.getWorkPackage).toHaveBeenCalledWith(
      workPackage.id,
    );
    expect(openProjectClient.updateWorkPackage).toHaveBeenCalledWith(
      workPackage.id,
      workPackage.lockVersion,
      { _links: { priority: { href: priority._links.self.href } } },
    );
  });

  it.each([
    ["assignee", "commandAssignWorkPackage"],
    ["responsible", "commandResponsibleWorkPackage"],
  ] as const)(
    "uses the fetched revision when setting a work-package %s",
    async (field, command) => {
      const storage = new RecordingStorage();
      const workPackage = { ...WORK_PACKAGE, lockVersion: 7 };
      const openProjectClient = {
        getOrigin: vi.fn(() => BASE_URL.origin),
        getIdentity: vi.fn().mockResolvedValue({
          id: 12,
          name: "Alice",
          _links: { self: { href: "/api/v3/users/12" } },
        }),
        getWorkPackage: vi.fn().mockResolvedValue(workPackage),
        hasAvailableAssignee: vi.fn().mockResolvedValue(true),
        getWorkPackageForm: vi.fn().mockResolvedValue({
          _embedded: {
            payload: {},
            schema: { assignee: { writable: true } },
            validationErrors: {},
          },
        }),
        updateWorkPackage: vi.fn().mockResolvedValue(workPackage),
      };
      const tokenStore = {
        getOpenProjectForUser: vi.fn().mockResolvedValue(openProjectClient),
      } as unknown as ConstructorParameters<typeof OpenProjectConnection>[6];
      const { connection } = createConnection(storage, [], tokenStore);

      if (command === "commandAssignWorkPackage") {
        await connection.commandAssignWorkPackage(
          "@alice:example.test",
          undefined,
          String(workPackage.id),
        );
      } else {
        await connection.commandResponsibleWorkPackage(
          "@alice:example.test",
          undefined,
          String(workPackage.id),
        );
      }

      expect(openProjectClient.getWorkPackage).toHaveBeenCalledTimes(1);
      expect(openProjectClient.getWorkPackage).toHaveBeenCalledWith(
        workPackage.id,
      );
      expect(openProjectClient.updateWorkPackage).toHaveBeenCalledWith(
        workPackage.id,
        workPackage.lockVersion,
        { _links: { [field]: { href: "/api/v3/users/12" } } },
      );
    },
  );

  it("reads the previous state before writing the updated state", async () => {
    const storage = new RecordingStorage();
    storage.activityState = workPackageToCacheState(WORK_PACKAGE);
    const { connection, intent } = createConnection(storage, [
      "work_package:subject_changed",
    ]);
    const updatedWorkPackage = {
      ...WORK_PACKAGE,
      lockVersion: WORK_PACKAGE.lockVersion + 1,
      subject: "Build the better bridge",
    };

    await connection.onWorkPackageUpdated(updatePayload(updatedWorkPackage));

    expect(storage.operations).toEqual([
      "get-anchor",
      "get-activity",
      "get-anchor",
      "set-activity",
    ]);
    expect(intent.sentEvents).toHaveLength(1);
    expect(intent.sentEvents[0].content.body).toContain("updated the subject");
    expect(
      intent.sentEvents[0].content[
        "org.matrix.matrix-hookshot.openproject.schema_version"
      ],
    ).toBe(OPENPROJECT_EVENT_SCHEMA_VERSION);
    expect(
      intent.sentEvents[0].content[
        "org.matrix.matrix-hookshot.openproject.event_kind"
      ],
    ).toBe("activity");
    expect(storage.activityState).toEqual(
      workPackageToCacheState(updatedWorkPackage),
    );
  });

  it("does not rewrite or send an Activity for a duplicate revision", async () => {
    const storage = new RecordingStorage();
    storage.activityState = workPackageToCacheState(WORK_PACKAGE);
    const { connection, intent } = createConnection(storage);

    await connection.onWorkPackageUpdated(updatePayload(WORK_PACKAGE));

    expect(storage.operations).toEqual(["get-anchor", "get-activity"]);
    expect(storage.activityState).toEqual(
      workPackageToCacheState(WORK_PACKAGE),
    );
    expect(intent.sentEvents).toHaveLength(0);
  });

  it("sends a generic update notification when no cached state exists", async () => {
    const storage = new RecordingStorage();
    const { connection, intent } = createConnection(storage);

    await connection.onWorkPackageUpdated(updatePayload(WORK_PACKAGE));

    expect(storage.operations).toEqual([
      "get-anchor",
      "get-activity",
      "get-anchor",
      "set-activity",
    ]);
    expect(intent.sentEvents).toHaveLength(1);
    expect(intent.sentEvents[0].content.body).toContain(
      "**Someone** updated the details on [#50 Build the bridge]",
    );
  });

  it("refreshes the cache without notifying for a filtered update", async () => {
    const storage = new RecordingStorage();
    storage.activityState = workPackageToCacheState(WORK_PACKAGE);
    const { connection, intent } = createConnection(storage, []);
    const updatedWorkPackage = {
      ...WORK_PACKAGE,
      lockVersion: WORK_PACKAGE.lockVersion + 1,
      subject: "Build the better bridge",
    };

    await connection.onWorkPackageUpdated(updatePayload(updatedWorkPackage));

    expect(storage.operations).toEqual([
      "get-anchor",
      "get-activity",
      "set-activity",
    ]);
    expect(storage.activityState).toEqual(
      workPackageToCacheState(updatedWorkPackage),
    );
    expect(intent.sentEvents).toHaveLength(0);
  });

  it("uses All updates as a wildcard and aggregates selected multi-field changes", async () => {
    const storage = new RecordingStorage();
    storage.activityState = workPackageToCacheState(WORK_PACKAGE);
    const { connection, intent } = createConnection(storage, [
      "work_package:updated",
    ]);
    const updatedWorkPackage = {
      ...WORK_PACKAGE,
      lockVersion: WORK_PACKAGE.lockVersion + 1,
      subject: "Updated subject",
      _embedded: {
        ...WORK_PACKAGE._embedded,
        priority: {
          ...WORK_PACKAGE._embedded.priority,
          id: WORK_PACKAGE._embedded.priority.id + 1,
          name: "High",
        },
      },
    };

    await connection.onWorkPackageUpdated(updatePayload(updatedWorkPackage));

    expect(intent.sentEvents).toHaveLength(1);
    expect(
      intent.sentEvents[0].content[
        "org.matrix.matrix-hookshot.openproject.changes"
      ],
    ).toEqual([
      "changed the priority from **Normal** to **High**",
      "updated the subject",
    ]);
    expect(
      intent.sentEvents[0].content[
        "org.matrix.matrix-hookshot.openproject.event_kind"
      ],
    ).toBe("activity");
  });

  it("advances a first update baseline when only a specific filter is enabled", async () => {
    const storage = new RecordingStorage();
    const { connection, intent } = createConnection(storage, [
      "work_package:subject_changed",
    ]);
    const baseline = {
      ...WORK_PACKAGE,
      lockVersion: WORK_PACKAGE.lockVersion + 1,
      subject: "Initial baseline",
    };
    const update = {
      ...baseline,
      lockVersion: baseline.lockVersion + 1,
      subject: "Changed after baseline",
    };

    await connection.onWorkPackageUpdated(updatePayload(baseline));
    expect(intent.sentEvents).toHaveLength(0);
    expect(storage.activityState).toEqual(workPackageToCacheState(baseline));

    await connection.onWorkPackageUpdated(updatePayload(update));
    expect(intent.sentEvents).toHaveLength(1);
    expect(
      intent.sentEvents[0].content[
        "org.matrix.matrix-hookshot.openproject.changes"
      ],
    ).toEqual(["updated the subject"]);
  });

  it("retries an Activity send without advancing its cursor on failure", async () => {
    const storage = new RecordingStorage();
    const { connection, intent } = createConnection(storage, [
      "work_package:created",
    ]);
    vi.spyOn(intent.underlyingClient, "sendMessage").mockRejectedValueOnce(
      new Error("temporary Matrix failure"),
    );

    await connection.onWorkPackageCreated(createPayload(WORK_PACKAGE));
    expect(storage.activityState).toBeNull();
    expect(intent.sentEvents).toHaveLength(0);

    await connection.onWorkPackageCreated(createPayload(WORK_PACKAGE));
    expect(storage.activityState).toEqual(
      workPackageToCacheState(WORK_PACKAGE),
    );
    expect(intent.sentEvents).toHaveLength(1);
    expect(
      intent.sentEvents[0].content[
        "org.matrix.matrix-hookshot.openproject.event_kind"
      ],
    ).toBe("activity");
  });

  it("keeps a successful anchor revision when the Activity send fails", async () => {
    const storage = new RecordingStorage();
    const { connection, intent } = createConnection(
      storage,
      ["work_package:subject_changed"],
      undefined as never,
      ["work_package:created"],
    );
    await connection.onWorkPackageCreated(createPayload(WORK_PACKAGE));
    const updated = {
      ...WORK_PACKAGE,
      lockVersion: WORK_PACKAGE.lockVersion + 1,
      subject: "Updated subject",
    };
    vi.spyOn(intent.underlyingClient, "sendMessage")
      .mockResolvedValueOnce("mocked-replacement")
      .mockRejectedValueOnce(new Error("Activity send failed"));

    await connection.onWorkPackageUpdated(updatePayload(updated));

    expect(storage.anchorState?.lockVersion).toBe(updated.lockVersion);
    expect(storage.activityState).toEqual(
      workPackageToCacheState(WORK_PACKAGE),
    );
  });

  it("links only later Activity events to an anchor after remove and re-add", async () => {
    const storage = new RecordingStorage();
    const { connection, intent } = createConnection(
      storage,
      ["work_package:created", "work_package:updated"],
      undefined as never,
      ["work_package:created"],
    );
    await connection.onWorkPackageCreated(createPayload(WORK_PACKAGE));
    expect(
      intent.sentEvents[1].content[
        "org.matrix.matrix-hookshot.openproject.anchor_event_id"
      ],
    ).toBe("event_0");

    await connection.commandTimelineRemove(String(WORK_PACKAGE.id));
    const afterRemoval = {
      ...WORK_PACKAGE,
      lockVersion: WORK_PACKAGE.lockVersion + 1,
      subject: "Updated without an active card",
    };
    await connection.onWorkPackageUpdated(updatePayload(afterRemoval));
    const removalActivity = intent.sentEvents[3].content;
    expect(removalActivity).not.toHaveProperty(
      "org.matrix.matrix-hookshot.openproject.anchor_event_id",
    );

    const afterReAdd = {
      ...afterRemoval,
      lockVersion: afterRemoval.lockVersion + 1,
      subject: "Updated with the new card",
    };
    await connection.onWorkPackageCreated(createPayload(afterReAdd));
    const reAddActivity = intent.sentEvents[5].content;
    expect(
      reAddActivity["org.matrix.matrix-hookshot.openproject.anchor_event_id"],
    ).toBe("event_4");
  });
});
