import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NotificationsEnableEvent,
  UserNotificationWatcher,
} from "../../src/notifications/UserNotificationWatcher";
import { GitHubWatcher } from "../../src/notifications/GitHubWatcher";
import { BridgeConfig } from "../../src/config/Config";

const USER_ID = "@alice:bar";

const config = {
  checkPermission: () => true,
  github: { baseUrl: new URL("https://api.github.com") },
} as unknown as BridgeConfig;

function enableEvent(
  data: Partial<NotificationsEnableEvent> = {},
): NotificationsEnableEvent {
  return {
    userId: USER_ID,
    roomId: "!foo:bar",
    token: "token",
    filterParticipating: false,
    type: "github",
    ...data,
  };
}

describe("UserNotificationWatcher", () => {
  let watcher: UserNotificationWatcher;
  let startedTasks: GitHubWatcher[];

  beforeEach(() => {
    startedTasks = [];
    // Avoid polling GitHub, and record each task that the watcher starts.
    vi.spyOn(GitHubWatcher.prototype, "start").mockImplementation(function (
      this: GitHubWatcher,
    ) {
      startedTasks.push(this);
    });
    watcher = new UserNotificationWatcher(config);
  });

  afterEach(() => {
    watcher.stop();
    vi.restoreAllMocks();
  });

  function getTask() {
    const task = startedTasks.at(-1);
    expect(task).toBeDefined();
    return task!;
  }

  it("accepts a since value of 0", () => {
    watcher.addUser(enableEvent({ since: 0 }));
    expect(getTask().since).toEqual(0);
  });

  it("keeps the running task's since value when the token changes", () => {
    watcher.addUser(enableEvent({ since: 1234 }));
    watcher.addUser(enableEvent({ token: "new-token" }));
    expect(getTask().since).toEqual(1234);
  });

  it("prefers the running task's since value over a stale stored one", () => {
    watcher.addUser(enableEvent({ since: 1234 }));
    watcher.addUser(enableEvent({ since: 0 }));
    expect(getTask().since).toEqual(1234);
  });

  it("prefers an explicit since value over a running task's value of 0", () => {
    watcher.addUser(enableEvent({ since: 0 }));
    watcher.addUser(enableEvent({ since: 1234 }));
    expect(getTask().since).toEqual(1234);
  });

  it("starts from 0 on a token change with no running task", () => {
    // Token updates do not include a since value.
    watcher.addUser(enableEvent({ token: "new-token" }));
    expect(getTask().since).toEqual(0);
  });
});
