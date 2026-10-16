import { describe, expect, it } from "vitest";
import { MemoryStorageProvider } from "../../src/stores/MemoryStorageProvider";
import { workPackageToCacheState } from "../../src/openproject/State";
import { WORK_PACKAGE } from "../openproject/WorkPackageFixtures";

describe("MemoryStorageProvider OpenProject Activity snapshots", () => {
  it("keeps snapshots connection-scoped and limits cleanup to one connection", async () => {
    const storage = new MemoryStorageProvider();
    const firstRoomState = workPackageToCacheState(WORK_PACKAGE);
    const secondRoomState = {
      ...firstRoomState,
      lockVersion: firstRoomState.lockVersion + 1,
    };
    await storage.setOpenProjectActivityState(
      "connection-a",
      WORK_PACKAGE.id,
      firstRoomState,
    );
    await storage.setOpenProjectActivityState(
      "connection-b",
      WORK_PACKAGE.id,
      secondRoomState,
    );

    expect(
      await storage.getOpenProjectActivityState(
        "connection-a",
        WORK_PACKAGE.id,
      ),
    ).toEqual(firstRoomState);
    expect(
      await storage.getOpenProjectActivityState(
        "connection-b",
        WORK_PACKAGE.id,
      ),
    ).toEqual(secondRoomState);

    await storage.deleteOpenProjectActivityStates("connection-a");
    expect(
      await storage.getOpenProjectActivityState(
        "connection-a",
        WORK_PACKAGE.id,
      ),
    ).toBeNull();
    expect(
      await storage.getOpenProjectActivityState(
        "connection-b",
        WORK_PACKAGE.id,
      ),
    ).toEqual(secondRoomState);
  });
});
