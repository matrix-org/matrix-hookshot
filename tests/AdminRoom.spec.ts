import { describe, it, expect } from "vitest";
import { Octokit } from "@octokit/rest";
import { AdminRoom } from "../src/AdminRoom";
import { DefaultConfig } from "../src/config/Defaults";
import { ConnectionManager } from "../src/ConnectionManager";
import { NotifFilter } from "../src/NotificationFilters";
import { UserTokenStore } from "../src/tokens/UserTokenStore";
import { IntentMock } from "./utils/IntentMock";
import { ConnectionType } from "../src/Connections/type";

const ROOM_ID = "!foo:bar";

function createAdminRoom(
  data: any = { admin_user: "@admin:bar" },
  tokenStore: UserTokenStore = {} as UserTokenStore,
): [AdminRoom, IntentMock] {
  const intent = IntentMock.create("@admin:bar");
  if (!data.admin_user) {
    data.admin_user = "@admin:bar";
  }
  return [
    new AdminRoom(
      ROOM_ID,
      data,
      NotifFilter.getDefaultContent(),
      intent,
      tokenStore,
      DefaultConfig,
      {} as ConnectionManager,
    ),
    intent,
  ];
}

describe("AdminRoom", () => {
  it("will present help text", async () => {
    const [adminRoom, intent] = createAdminRoom();
    await adminRoom.handleCommand("$foo:bar", "help");
    expect(intent.sentEvents).toHaveLength(1);
    expect(intent.sentEvents[0]).toEqual({
      roomId: ROOM_ID,
      content: AdminRoom.helpMessage(undefined, [
        ConnectionType.Github,
        ConnectionType.Gitlab,
        ConnectionType.Jira,
        ConnectionType.OpenProject,
      ]),
    });
  });

  it("reports a missing GitHub project from an Octokit 404 response", async () => {
    const octokit = new Octokit({
      request: {
        fetch: async () =>
          new Response(JSON.stringify({ message: "Not Found" }), {
            status: 404,
            headers: { "content-type": "application/json" },
          }),
      },
    });
    const tokenStore = {
      getOctokitForUser: async () => octokit,
    } as unknown as UserTokenStore;
    const [adminRoom, intent] = createAdminRoom(undefined, tokenStore);

    await adminRoom.handleCommand("$foo:bar", "github project open 42");

    expect(intent.sentEvents).toContainEqual({
      roomId: ROOM_ID,
      content: {
        msgtype: "m.notice",
        body: "Project does not exist.",
      },
    });
  });

  it("does not treat a plain object as an Octokit 404 error", async () => {
    const tokenStore = {
      getOctokitForUser: async () => ({
        projects: {
          get: async () => {
            throw { status: 404 };
          },
        },
      }),
    } as unknown as UserTokenStore;
    const [adminRoom, intent] = createAdminRoom(undefined, tokenStore);

    await adminRoom.handleCommand("$foo:bar", "github project open 42");

    expect(intent.sentEvents).toContainEqual({
      roomId: ROOM_ID,
      content: {
        msgtype: "m.notice",
        body: "Failed to fetch project due to an error. See logs for details.",
      },
    });
  });
});
