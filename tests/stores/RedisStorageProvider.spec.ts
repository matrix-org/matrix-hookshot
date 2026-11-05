import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatWorkPackageAnchorContent } from "../../src/openproject/Format";
import { RedisStorageProvider } from "../../src/stores/RedisStorageProvider";
import { workPackageToCacheState } from "../../src/openproject/State";
import { BASE_URL, WORK_PACKAGE } from "../openproject/WorkPackageFixtures";

const redisMock = vi.hoisted(() => ({
  expire: vi.fn().mockResolvedValue(1),
  get: vi.fn(),
  multi: vi.fn(),
  smembers: vi.fn(),
  strings: new Map<string, string>(),
  sets: new Map<string, Set<string>>(),
}));

vi.mock("ioredis", () => ({
  default: class {
    public readonly expire = redisMock.expire;
    public readonly get = redisMock.get;
    public readonly multi = redisMock.multi;
    public readonly smembers = redisMock.smembers;
  },
}));

function createStoredAnchor(anchorEventId: string, lockVersion: number) {
  return {
    anchorEventId,
    lockVersion,
    lastContent: formatWorkPackageAnchorContent(
      { ...WORK_PACKAGE, lockVersion },
      BASE_URL,
      { snapshotId: `snapshot-${lockVersion}` },
    ),
  };
}

function createTransaction() {
  const commands: Array<() => unknown> = [];
  return {
    set(key: string, value: string) {
      commands.push(() => {
        redisMock.strings.set(key, value);
        return "OK";
      });
    },
    sadd(key: string, value: string) {
      commands.push(() => {
        const members = redisMock.sets.get(key) ?? new Set<string>();
        members.add(value);
        redisMock.sets.set(key, members);
        return 1;
      });
    },
    del(key: string) {
      commands.push(() => {
        const deletedString = redisMock.strings.delete(key);
        const deletedSet = redisMock.sets.delete(key);
        return Number(deletedString || deletedSet);
      });
    },
    srem(key: string, value: string) {
      commands.push(() =>
        Number(redisMock.sets.get(key)?.delete(value) ?? false),
      );
    },
    async exec(): Promise<Array<[Error | null, unknown]>> {
      return commands.map((command) => [null, command()]);
    },
  };
}

describe("RedisStorageProvider OpenProject anchors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisMock.strings.clear();
    redisMock.sets.clear();
    redisMock.get.mockImplementation(
      async (key: string) => redisMock.strings.get(key) ?? null,
    );
    redisMock.smembers.mockImplementation(async (key: string) => [
      ...(redisMock.sets.get(key) ?? []),
    ]);
    redisMock.multi.mockImplementation(createTransaction);
  });

  it("retains connection-scoped anchors across provider recreation", async () => {
    const firstProvider = new RedisStorageProvider({
      redisUri: "redis://unused",
    });
    const firstAnchor = createStoredAnchor("$first", 1);
    const secondAnchor = createStoredAnchor("$second", 2);
    const otherConnectionAnchor = createStoredAnchor("$other", 3);
    await firstProvider.setOpenProjectAnchorState(
      "connection-a",
      50,
      firstAnchor,
    );
    await firstProvider.setOpenProjectAnchorState(
      "connection-a",
      51,
      secondAnchor,
    );
    await firstProvider.setOpenProjectAnchorState(
      "connection-b",
      50,
      otherConnectionAnchor,
    );

    const recreatedProvider = new RedisStorageProvider({
      redisUri: "redis://unused",
    });
    expect(
      await recreatedProvider.getOpenProjectAnchorState("connection-a", 50),
    ).toEqual(firstAnchor);
    expect(
      await recreatedProvider.getOpenProjectAnchorState("connection-a", 51),
    ).toEqual(secondAnchor);
    expect(
      await recreatedProvider.getOpenProjectAnchorState("connection-b", 50),
    ).toEqual(otherConnectionAnchor);

    const revisedAnchor = createStoredAnchor("$first", 4);
    await recreatedProvider.setOpenProjectAnchorState(
      "connection-a",
      50,
      revisedAnchor,
    );
    expect(
      await firstProvider.getOpenProjectAnchorState("connection-a", 50),
    ).toEqual(revisedAnchor);

    await recreatedProvider.deleteOpenProjectAnchorState("connection-a", 50);
    expect(
      await firstProvider.getOpenProjectAnchorState("connection-a", 50),
    ).toBeNull();
    expect(
      await firstProvider.getOpenProjectAnchorState("connection-a", 51),
    ).toEqual(secondAnchor);

    await recreatedProvider.deleteOpenProjectAnchorStates("connection-a");
    expect(
      await firstProvider.getOpenProjectAnchorState("connection-a", 51),
    ).toBeNull();
    expect(
      await firstProvider.getOpenProjectAnchorState("connection-b", 50),
    ).toEqual(otherConnectionAnchor);
  });

  it.each(["set", "delete one", "delete all"] as const)(
    "reports a command error from %s",
    async (operation) => {
      const commandError = new Error("WRONGTYPE");
      const transaction = {
        set: vi.fn(),
        sadd: vi.fn(),
        del: vi.fn(),
        srem: vi.fn(),
        exec: vi.fn().mockResolvedValue([
          [null, "OK"],
          [commandError, null],
        ]),
      };
      redisMock.multi.mockReturnValue(transaction);
      const provider = new RedisStorageProvider({
        redisUri: "redis://unused",
      });

      const action =
        operation === "set"
          ? provider.setOpenProjectAnchorState(
              "connection",
              50,
              createStoredAnchor("$anchor", 1),
            )
          : operation === "delete one"
            ? provider.deleteOpenProjectAnchorState("connection", 50)
            : provider.deleteOpenProjectAnchorStates("connection");

      await expect(action).rejects.toBe(commandError);
      expect(transaction.exec).toHaveBeenCalledOnce();
    },
  );

  it("reports an aborted transaction", async () => {
    const transaction = {
      set: vi.fn(),
      sadd: vi.fn(),
      exec: vi.fn().mockResolvedValue(null),
    };
    redisMock.multi.mockReturnValue(transaction);
    const provider = new RedisStorageProvider({ redisUri: "redis://unused" });

    await expect(
      provider.setOpenProjectAnchorState(
        "connection",
        50,
        createStoredAnchor("$anchor", 1),
      ),
    ).rejects.toThrow("transaction was aborted");
  });
});

describe("RedisStorageProvider OpenProject Activity snapshots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisMock.strings.clear();
    redisMock.sets.clear();
    redisMock.get.mockImplementation(
      async (key: string) => redisMock.strings.get(key) ?? null,
    );
    redisMock.smembers.mockImplementation(async (key: string) => [
      ...(redisMock.sets.get(key) ?? []),
    ]);
    redisMock.multi.mockImplementation(createTransaction);
  });

  it("stores independent connection snapshots across provider recreation and cleans up one connection", async () => {
    const firstProvider = new RedisStorageProvider({
      redisUri: "redis://unused",
    });
    const firstRoomState = workPackageToCacheState(WORK_PACKAGE);
    const secondRoomState = {
      ...firstRoomState,
      lockVersion: firstRoomState.lockVersion + 1,
    };
    await firstProvider.setOpenProjectActivityState(
      "connection-a",
      WORK_PACKAGE.id,
      firstRoomState,
    );
    await firstProvider.setOpenProjectActivityState(
      "connection-b",
      WORK_PACKAGE.id,
      secondRoomState,
    );

    const recreatedProvider = new RedisStorageProvider({
      redisUri: "redis://unused",
    });
    expect(
      await recreatedProvider.getOpenProjectActivityState(
        "connection-a",
        WORK_PACKAGE.id,
      ),
    ).toEqual(firstRoomState);
    expect(
      await recreatedProvider.getOpenProjectActivityState(
        "connection-b",
        WORK_PACKAGE.id,
      ),
    ).toEqual(secondRoomState);

    await recreatedProvider.deleteOpenProjectActivityStates("connection-a");
    expect(
      await firstProvider.getOpenProjectActivityState(
        "connection-a",
        WORK_PACKAGE.id,
      ),
    ).toBeNull();
    expect(
      await firstProvider.getOpenProjectActivityState(
        "connection-b",
        WORK_PACKAGE.id,
      ),
    ).toEqual(secondRoomState);
    expect(
      redisMock.strings.has(
        `openproject.activity.v1:connection-a:${WORK_PACKAGE.id}`,
      ),
    ).toBe(false);
    expect(
      redisMock.strings.has(
        `openproject.activity.v1:connection-b:${WORK_PACKAGE.id}`,
      ),
    ).toBe(true);
  });
});
