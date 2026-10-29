import { describe, expect, it, vi } from "vitest";
import {
  RoomEvent,
  type Intent,
  type MatrixEvent,
  type StateEvent,
} from "matrix-bot-sdk";
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
import { BASE_URL, WORK_PACKAGE } from "../openproject/WorkPackageFixtures";
import {
  formatWorkPackageActivityForMatrix,
  formatWorkPackageAnchorContent,
} from "../../src/openproject/Format";

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
  tokenStoreOverride?: UserTokenStore,
): OpenProjectConnection {
  const appservice = AppserviceMock.create();
  const intent =
    intentOverride ??
    appservice.getIntentForUserId("@openproject:example.test");
  intent.underlyingClient.sendEvent = vi.fn().mockResolvedValue("$sent");
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
      tokenStore: tokenStoreOverride ?? ({} as UserTokenStore),
      commentProcessor: undefined as never,
      messageClient: undefined as never,
      storage: storageOverride ?? ({} as InstantiateConnectionOpts["storage"]),
    },
  );
}

function createAssignmentHarness(availableUserIds = [7, 12]) {
  const makeClient = (id: number, name: string) => ({
    getOrigin: vi.fn(() => BASE_URL.origin),
    getIdentity: vi.fn().mockResolvedValue({
      id,
      name,
      _links: { self: { href: `/api/v3/users/${id}` } },
    }),
    getWorkPackage: vi.fn().mockResolvedValue({
      ...WORK_PACKAGE,
      lockVersion: 8,
    }),
    hasAvailableAssignee: vi.fn(
      async (_workPackageId: number, userId: number) =>
        availableUserIds.includes(userId),
    ),
    getWorkPackageForm: vi.fn().mockResolvedValue({
      _embedded: {
        payload: {},
        schema: { assignee: { writable: true } },
        validationErrors: {},
      },
    }),
    updateWorkPackage: vi.fn().mockResolvedValue(undefined),
    searchForUserInProject: vi.fn().mockResolvedValue({
      href: "/api/v3/users/12",
    }),
  });
  const senderClient = makeClient(7, "Alice");
  const targetClient = makeClient(12, "Bob");
  const tokenStore = {
    getOpenProjectForUser: vi.fn(async (matrixUserId: string) =>
      matrixUserId === "@bob:example.test" ? targetClient : senderClient,
    ),
  } as unknown as UserTokenStore;
  const connection = createConnectionState(
    { commandPrefix: "!openproject dev-work-package-sharing" },
    undefined,
    undefined,
    tokenStore,
  );

  return { connection, senderClient, targetClient, tokenStore };
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
  it("shows project-specific and reply-based help forms with the right prefixes", () => {
    const help = OpenProjectConnection.helpMessage(
      "!openproject <projectId> ",
      undefined,
      undefined,
      "!openproject ",
    );

    expect(help.body).toContain(
      " - `!openproject <projectId> priority <workPackageId> <priority>` - Set the priority for a work package",
    );
    expect(help.body).toContain(
      " - `!openproject priority <priority>` (reply to a work package) - Set the priority for a work package",
    );
    expect(help.body).toContain(
      " - `!openproject <projectId> assign <workPackageId> [user]` - Assign a work package to a new user (use 'unset' to remove)",
    );
    expect(help.body).toContain(
      " - `!openproject assign [user]` (reply to a work package) - Assign a work package to a new user (use 'unset' to remove)",
    );
    expect(help.body).toContain(
      " - `!openproject <projectId> responsible <workPackageId> [user]` - Assign a responsible user to a work package (use 'unset' to remove)",
    );
    expect(help.body).toContain(
      " - `!openproject responsible [user]` (reply to a work package) - Assign a responsible user to a work package (use 'unset' to remove)",
    );
    expect(help.body).toContain(" - `!openproject help` - This help text");
    expect(help.body).toContain(
      " - `!openproject <projectId> timeline remove <workPackageId>` - Remove a work package from the timeline",
    );
    expect(help.body).toContain(
      " - `!openproject timeline remove` (reply to a work package) - Remove a work package from the timeline",
    );
    expect(help.formatted_body).toContain(
      "<code>!openproject &lt;projectId&gt; priority &lt;workPackageId&gt; &lt;priority&gt;</code>",
    );
  });

  it("removes a timeline anchor when invoked with a global prefix in a reply", async () => {
    const connection = createConnectionState({
      commandPrefix: "!openproject demo-project",
    });
    const reply = new RoomEvent({
      content: formatWorkPackageAnchorContent(WORK_PACKAGE, BASE_URL, {
        snapshotId: "reply-anchor",
      }),
      event_id: "$anchor",
      room_id: ROOM_ID,
      origin_server_ts: Date.now(),
      sender: "@hookshot:example.test",
      state_key: undefined,
      type: "m.room.message",
    });
    const getEvent = vi.fn().mockResolvedValue(reply);
    connection["as"].botClient.getEvent = getEvent;
    const removeTimelineWorkPackage = vi
      .spyOn(connection["timelineCommandService"], "removeTimelineWorkPackage")
      .mockResolvedValue(undefined);
    const commandEvent = {
      content: {
        body: "!openproject timeline remove",
        "m.relates_to": { "m.in_reply_to": { event_id: "$anchor" } },
        msgtype: "m.text" as const,
      },
      event_id: "$remove-command",
      origin_server_ts: Date.now(),
      sender: "@alice:example.test",
      state_key: undefined,
      type: "m.room.message",
    };

    expect(await connection.onMessageEvent(commandEvent, () => true)).toBe(
      true,
    );
    expect(getEvent).toHaveBeenCalledWith(ROOM_ID, "$anchor");
    expect(removeTimelineWorkPackage).toHaveBeenCalledWith(
      String(WORK_PACKAGE.id),
    );
  });

  describe("assignment command", () => {
    it("self-assigns from an activity reply with the global prefix", async () => {
      const { connection, senderClient, tokenStore } =
        createAssignmentHarness();
      const activityContent = formatWorkPackageActivityForMatrix(
        WORK_PACKAGE,
        BASE_URL,
        ["updated the subject"],
      );
      const activity = new RoomEvent({
        event_id: "$activity",
        room_id: ROOM_ID,
        origin_server_ts: Date.now(),
        sender: "@openproject:example.test",
        type: "m.room.message",
        content: activityContent,
      });
      const getEvent = vi.fn().mockResolvedValue(activity);
      connection["as"].botClient.getEvent = getEvent;
      const otherConnection = createConnectionState(
        {
          url: `${BASE_URL}projects/2`,
          commandPrefix: "!openproject other-project",
        },
        undefined,
        undefined,
        tokenStore,
      );
      otherConnection["as"].botClient.getEvent = getEvent;
      const event = {
        content: {
          body: "!openproject assign",
          "m.mentions": { user_ids: ["@openproject:example.test"] },
          "m.relates_to": { "m.in_reply_to": { event_id: "$activity" } },
          msgtype: "m.text" as const,
        },
        event_id: "$activity-reply",
        origin_server_ts: Date.now(),
        sender: "@alice:example.test",
        state_key: undefined,
        type: "m.room.message",
      };

      expect(await otherConnection.onMessageEvent(event, () => true)).toBe(
        false,
      );
      expect(senderClient.updateWorkPackage).not.toHaveBeenCalled();
      expect(await connection.onMessageEvent(event, () => true)).toBe(true);

      expect(getEvent).toHaveBeenCalledWith(ROOM_ID, "$activity");
      expect(senderClient.updateWorkPackage).toHaveBeenCalledWith(
        WORK_PACKAGE.id,
        8,
        { _links: { assignee: { href: "/api/v3/users/7" } } },
      );
    });

    it("rejects a reply without OpenProject project metadata", () => {
      const { connection } = createAssignmentHarness();
      const unrelatedReply = {
        type: "m.room.message",
        content: {
          "org.matrix.matrix-hookshot.openproject.work_package": {
            id: WORK_PACKAGE.id,
          },
        },
      } as MatrixEvent<unknown>;

      expect(() =>
        connection.getWorkPackageIDFromReply(unrelatedReply),
      ).toThrow("Did not reference a hookshot event");
    });

    it("self-assigns with the global prefix from a new-style anchor reply", async () => {
      const { connection, senderClient, tokenStore } =
        createAssignmentHarness();
      const anchor = new RoomEvent({
        event_id: "$anchor",
        room_id: ROOM_ID,
        origin_server_ts: Date.now(),
        sender: "@openproject:example.test",
        type: "m.room.message",
        content: {
          "org.matrix.matrix-hookshot.openproject.project": { id: 1 },
          "org.matrix.matrix-hookshot.openproject.work_package": {
            id: WORK_PACKAGE.id,
          },
        },
      });
      const getEvent = vi.fn().mockResolvedValue(anchor);
      connection["as"].botClient.getEvent = getEvent;
      const event = {
        content: {
          body: "!openproject assign",
          "m.mentions": { user_ids: ["@openproject:example.test"] },
          "m.relates_to": { "m.in_reply_to": { event_id: "$anchor" } },
          msgtype: "m.text" as const,
        },
        event_id: "$reply",
        origin_server_ts: Date.now(),
        sender: "@alice:example.test",
        state_key: undefined,
        type: "m.room.message",
      };

      const otherConnection = createConnectionState(
        {
          url: `${BASE_URL}projects/2`,
          commandPrefix: "!openproject other-project",
        },
        undefined,
        undefined,
        tokenStore,
      );
      otherConnection["as"].botClient.getEvent = getEvent;
      expect(await otherConnection.onMessageEvent(event, () => true)).toBe(
        false,
      );
      expect(senderClient.updateWorkPackage).not.toHaveBeenCalled();

      await connection.onMessageEvent(event, () => true);

      expect(getEvent).toHaveBeenCalledWith(ROOM_ID, "$anchor");
      expect(senderClient.updateWorkPackage).toHaveBeenCalledWith(
        WORK_PACKAGE.id,
        8,
        { _links: { assignee: { href: "/api/v3/users/7" } } },
      );
    });

    it("self-assigns an explicitly identified work package", async () => {
      const { connection, senderClient } = createAssignmentHarness();

      await connection.commandAssignWorkPackage(
        "@alice:example.test",
        undefined,
        String(WORK_PACKAGE.id),
      );

      expect(senderClient.getWorkPackage).toHaveBeenCalledWith(WORK_PACKAGE.id);
      expect(senderClient.hasAvailableAssignee).toHaveBeenCalledWith(
        WORK_PACKAGE.id,
        7,
      );
      expect(senderClient.getWorkPackageForm).toHaveBeenCalledWith(
        WORK_PACKAGE.id,
        { lockVersion: 8, _links: { assignee: { href: "/api/v3/users/7" } } },
      );
      expect(senderClient.updateWorkPackage).toHaveBeenCalledWith(
        WORK_PACKAGE.id,
        8,
        { _links: { assignee: { href: "/api/v3/users/7" } } },
      );
      expect(
        senderClient.hasAvailableAssignee.mock.invocationCallOrder[0],
      ).toBeLessThan(
        senderClient.updateWorkPackage.mock.invocationCallOrder[0],
      );
      expect(
        senderClient.getWorkPackageForm.mock.invocationCallOrder[0],
      ).toBeLessThan(
        senderClient.updateWorkPackage.mock.invocationCallOrder[0],
      );
    });

    it("resolves a named project member before assignment", async () => {
      const { connection, senderClient } = createAssignmentHarness();

      await connection.commandAssignWorkPackage(
        "@alice:example.test",
        undefined,
        String(WORK_PACKAGE.id),
        "Bob Smith",
      );

      expect(senderClient.searchForUserInProject).toHaveBeenCalledWith(
        1,
        "Bob Smith",
      );
      expect(senderClient.hasAvailableAssignee).toHaveBeenCalledWith(
        WORK_PACKAGE.id,
        12,
      );
      expect(senderClient.getWorkPackageForm).toHaveBeenCalledWith(
        WORK_PACKAGE.id,
        { lockVersion: 8, _links: { assignee: { href: "/api/v3/users/12" } } },
      );
      expect(senderClient.updateWorkPackage).toHaveBeenCalledWith(
        WORK_PACKAGE.id,
        8,
        { _links: { assignee: { href: "/api/v3/users/12" } } },
      );
      expect(
        senderClient.hasAvailableAssignee.mock.invocationCallOrder[0],
      ).toBeLessThan(
        senderClient.updateWorkPackage.mock.invocationCallOrder[0],
      );
      expect(
        senderClient.getWorkPackageForm.mock.invocationCallOrder[0],
      ).toBeLessThan(
        senderClient.updateWorkPackage.mock.invocationCallOrder[0],
      );
    });

    it("joins an unquoted multiword assignee name", async () => {
      const { connection, senderClient } = createAssignmentHarness();

      await connection.commandAssignWorkPackage(
        "@alice:example.test",
        undefined,
        String(WORK_PACKAGE.id),
        "Member",
        "DEV",
        "user",
      );

      expect(senderClient.searchForUserInProject).toHaveBeenCalledWith(
        1,
        "Member DEV user",
      );
      expect(senderClient.updateWorkPackage).toHaveBeenCalledOnce();
    });

    it("resolves an Element Web mention pill to its Matrix user ID", async () => {
      const { connection, senderClient, tokenStore } =
        createAssignmentHarness();
      vi.mocked(tokenStore.getOpenProjectForUser).mockImplementation(
        async (userId) =>
          userId === "@hookshot:localhost" ? null : (senderClient as never),
      );
      const content = {
        body: "!openproject dev-work-package-sharing assign 49 hookshot ",
        format: "org.matrix.custom.html",
        formatted_body:
          '!openproject dev-work-package-sharing assign 49 <a href="https://matrix.to/#/@hookshot:localhost">hookshot</a>',
        "m.mentions": { user_ids: ["@hookshot:localhost"] },
        msgtype: "m.text" as const,
      };
      const event = {
        content,
        event_id: "$mention",
        origin_server_ts: Date.now(),
        sender: "@alice:example.test",
        state_key: undefined,
        type: "m.room.message",
      };

      await connection.onMessageEvent(event, () => true);

      expect(tokenStore.getOpenProjectForUser).toHaveBeenCalledWith(
        "@hookshot:localhost",
      );
      expect(senderClient.searchForUserInProject).not.toHaveBeenCalled();
      expect(senderClient.updateWorkPackage).not.toHaveBeenCalled();
    });

    it("ignores mention metadata without a trailing user pill", async () => {
      const { connection, senderClient, tokenStore } =
        createAssignmentHarness();
      const content = {
        body: "!openproject dev-work-package-sharing assign 49 hookshot ",
        format: "org.matrix.custom.html",
        formatted_body:
          "!openproject dev-work-package-sharing assign 49 hookshot",
        "m.mentions": { user_ids: ["@hookshot:localhost"] },
        msgtype: "m.text" as const,
      };
      const event = {
        content,
        event_id: "$unrelated-mention",
        origin_server_ts: Date.now(),
        sender: "@alice:example.test",
        state_key: undefined,
        type: "m.room.message",
      };

      await connection.onMessageEvent(event, () => true);

      expect(tokenStore.getOpenProjectForUser).not.toHaveBeenCalledWith(
        "@hookshot:localhost",
      );
      expect(senderClient.searchForUserInProject).toHaveBeenCalledWith(
        1,
        "hookshot",
      );
      expect(senderClient.updateWorkPackage).toHaveBeenCalledOnce();
    });

    it("resolves a Matrix ID to its coupled OpenProject identity", async () => {
      const { connection, senderClient, targetClient, tokenStore } =
        createAssignmentHarness();

      await connection.commandAssignWorkPackage(
        "@alice:example.test",
        undefined,
        String(WORK_PACKAGE.id),
        "@bob:example.test",
      );

      expect(tokenStore.getOpenProjectForUser).toHaveBeenCalledWith(
        "@bob:example.test",
      );
      expect(targetClient.getIdentity).toHaveBeenCalledOnce();
      expect(senderClient.searchForUserInProject).not.toHaveBeenCalled();
      expect(senderClient.hasAvailableAssignee).toHaveBeenCalledWith(
        WORK_PACKAGE.id,
        12,
      );
      expect(senderClient.getWorkPackageForm).toHaveBeenCalledWith(
        WORK_PACKAGE.id,
        { lockVersion: 8, _links: { assignee: { href: "/api/v3/users/12" } } },
      );
      expect(senderClient.updateWorkPackage).toHaveBeenCalledWith(
        WORK_PACKAGE.id,
        8,
        { _links: { assignee: { href: "/api/v3/users/12" } } },
      );
      expect(
        senderClient.hasAvailableAssignee.mock.invocationCallOrder[0],
      ).toBeLessThan(
        senderClient.updateWorkPackage.mock.invocationCallOrder[0],
      );
      expect(
        senderClient.getWorkPackageForm.mock.invocationCallOrder[0],
      ).toBeLessThan(
        senderClient.updateWorkPackage.mock.invocationCallOrder[0],
      );
    });

    it("clears the assignee when given unset in reply shorthand", async () => {
      const { connection, senderClient } = createAssignmentHarness();
      const reply = {
        type: "m.room.message",
        content: {
          "org.matrix.matrix-hookshot.openproject.project": { id: 1 },
          "org.matrix.matrix-hookshot.openproject.work_package": {
            id: WORK_PACKAGE.id,
          },
        },
      } as MatrixEvent<unknown>;

      await connection.commandAssignWorkPackage(
        "@alice:example.test",
        reply,
        "unset",
      );

      expect(senderClient.getWorkPackage).toHaveBeenCalledWith(WORK_PACKAGE.id);
      expect(senderClient.hasAvailableAssignee).not.toHaveBeenCalled();
      expect(senderClient.getWorkPackageForm).toHaveBeenCalledWith(
        WORK_PACKAGE.id,
        { lockVersion: 8, _links: { assignee: { href: null } } },
      );
      expect(senderClient.updateWorkPackage).toHaveBeenCalledWith(
        WORK_PACKAGE.id,
        8,
        { _links: { assignee: { href: null } } },
      );
      expect(
        senderClient.getWorkPackageForm.mock.invocationCallOrder[0],
      ).toBeLessThan(
        senderClient.updateWorkPackage.mock.invocationCallOrder[0],
      );
    });

    it("joins an unquoted assignee name in reply shorthand", async () => {
      const { connection, senderClient } = createAssignmentHarness();
      const reply = {
        type: "m.room.message",
        content: {
          "org.matrix.matrix-hookshot.openproject.project": { id: 1 },
          "org.matrix.matrix-hookshot.openproject.work_package": {
            id: WORK_PACKAGE.id,
          },
        },
      } as MatrixEvent<unknown>;

      await connection.commandAssignWorkPackage(
        "@alice:example.test",
        reply,
        "Member",
        "DEV",
        "user",
      );

      expect(senderClient.searchForUserInProject).toHaveBeenCalledWith(
        1,
        "Member DEV user",
      );
      expect(senderClient.updateWorkPackage).toHaveBeenCalledOnce();
    });

    it("reports an unavailable target without mutating the work package", async () => {
      const { connection, senderClient } = createAssignmentHarness([7]);

      await expect(
        connection.commandAssignWorkPackage(
          "@alice:example.test",
          undefined,
          String(WORK_PACKAGE.id),
          "Bob Smith",
        ),
      ).rejects.toMatchObject({
        message: "Assignee unavailable",
        humanError: "That user cannot be assigned to this work package.",
      });

      expect(senderClient.updateWorkPackage).not.toHaveBeenCalled();
    });
  });

  describe("responsible command", () => {
    it("sets the responsible user to the sender by default", async () => {
      const { connection, senderClient } = createAssignmentHarness();

      await connection.commandResponsibleWorkPackage(
        "@alice:example.test",
        undefined,
        String(WORK_PACKAGE.id),
      );

      expect(senderClient.getWorkPackage).toHaveBeenCalledWith(WORK_PACKAGE.id);
      expect(senderClient.updateWorkPackage).toHaveBeenCalledWith(
        WORK_PACKAGE.id,
        8,
        { _links: { responsible: { href: "/api/v3/users/7" } } },
      );
    });

    it("resolves an unquoted multiword project member", async () => {
      const { connection, senderClient } = createAssignmentHarness();

      await connection.commandResponsibleWorkPackage(
        "@alice:example.test",
        undefined,
        String(WORK_PACKAGE.id),
        "Bob",
        "Smith",
      );

      expect(senderClient.searchForUserInProject).toHaveBeenCalledWith(
        1,
        "Bob Smith",
      );
      expect(senderClient.updateWorkPackage).toHaveBeenCalledWith(
        WORK_PACKAGE.id,
        8,
        { _links: { responsible: { href: "/api/v3/users/12" } } },
      );
    });

    it("resolves a Matrix ID to its coupled OpenProject identity", async () => {
      const { connection, senderClient, targetClient, tokenStore } =
        createAssignmentHarness();

      await connection.commandResponsibleWorkPackage(
        "@alice:example.test",
        undefined,
        String(WORK_PACKAGE.id),
        "@bob:example.test",
      );

      expect(tokenStore.getOpenProjectForUser).toHaveBeenCalledWith(
        "@bob:example.test",
      );
      expect(targetClient.getIdentity).toHaveBeenCalledOnce();
      expect(senderClient.searchForUserInProject).not.toHaveBeenCalled();
      expect(senderClient.updateWorkPackage).toHaveBeenCalledWith(
        WORK_PACKAGE.id,
        8,
        { _links: { responsible: { href: "/api/v3/users/12" } } },
      );
    });

    it("clears the responsible user when given unset", async () => {
      const { connection, senderClient } = createAssignmentHarness();

      await connection.commandResponsibleWorkPackage(
        "@alice:example.test",
        undefined,
        String(WORK_PACKAGE.id),
        "unset",
      );

      expect(senderClient.updateWorkPackage).toHaveBeenCalledWith(
        WORK_PACKAGE.id,
        8,
        { _links: { responsible: { href: null } } },
      );
    });

    it("supports reply shorthand with an explicit responsible user", async () => {
      const { connection, senderClient } = createAssignmentHarness();
      const reply = {
        type: "m.room.message",
        content: {
          "org.matrix.matrix-hookshot.openproject.project": { id: 1 },
          "org.matrix.matrix-hookshot.openproject.work_package": {
            id: WORK_PACKAGE.id,
          },
        },
      } as MatrixEvent<unknown>;

      await connection.commandResponsibleWorkPackage(
        "@alice:example.test",
        reply,
        "Bob Smith",
      );

      expect(senderClient.searchForUserInProject).toHaveBeenCalledWith(
        1,
        "Bob Smith",
      );
      expect(senderClient.updateWorkPackage).toHaveBeenCalledWith(
        WORK_PACKAGE.id,
        8,
        { _links: { responsible: { href: "/api/v3/users/12" } } },
      );
    });

    it("rejects an unknown name without mutating the work package", async () => {
      const { connection, senderClient } = createAssignmentHarness();
      senderClient.searchForUserInProject.mockResolvedValue(null);

      await expect(
        connection.commandResponsibleWorkPackage(
          "@alice:example.test",
          undefined,
          String(WORK_PACKAGE.id),
          "Unknown User",
        ),
      ).rejects.toMatchObject({
        message: "Invalid user",
        humanError: "Could not find a user by that name",
      });

      expect(senderClient.updateWorkPackage).not.toHaveBeenCalled();
    });

    it("requires the sender to be connected to OpenProject", async () => {
      const tokenStore = {
        getOpenProjectForUser: vi.fn().mockResolvedValue(null),
      } as unknown as UserTokenStore;
      const connection = createConnectionState(
        {},
        undefined,
        undefined,
        tokenStore,
      );

      await expect(
        connection.commandResponsibleWorkPackage(
          "@alice:example.test",
          undefined,
          String(WORK_PACKAGE.id),
        ),
      ).rejects.toMatchObject({
        message: "User is not logged in",
        humanError: "You are not logged in",
      });
    });
  });

  it("deletes all active anchors during connection cleanup", async () => {
    const storage = {
      deleteOpenProjectAnchorStates: vi.fn().mockResolvedValue(undefined),
      deleteOpenProjectActivityStates: vi.fn().mockResolvedValue(undefined),
    } as unknown as InstantiateConnectionOpts["storage"];
    const connection = createConnectionState({}, undefined, storage);

    await connection.cleanupTimelineState();

    expect(storage.deleteOpenProjectAnchorStates).toHaveBeenCalledWith(
      connection.connectionId,
    );
    expect(storage.deleteOpenProjectActivityStates).toHaveBeenCalledWith(
      connection.connectionId,
    );
  });

  it("retains a usable connection and its anchors when Matrix state removal fails", async () => {
    const appservice = AppserviceMock.create();
    const intent = appservice.getIntentForUserId("@openproject:example.test");
    intent.underlyingClient.getRoomStateEventContent = vi
      .fn()
      .mockResolvedValue({});
    const sendStateEvent = vi
      .spyOn(intent.underlyingClient, "sendStateEvent")
      .mockRejectedValueOnce(new Error("Matrix unavailable"));
    const ungrant = vi.spyOn(intent.underlyingClient, "setRoomAccountData");
    const storage = {
      deleteOpenProjectAnchorStates: vi.fn().mockResolvedValue(undefined),
      deleteOpenProjectActivityStates: vi.fn().mockResolvedValue(undefined),
    } as unknown as InstantiateConnectionOpts["storage"];
    const connection = createConnectionState({}, intent, storage);
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

    await expect(
      manager.purgeConnection(ROOM_ID, connection.connectionId, false),
    ).rejects.toThrow("Matrix unavailable");

    expect(manager.getConnectionById(ROOM_ID, connection.connectionId)).toBe(
      connection,
    );
    expect(connection.interestedInProject(1)).toBe(true);
    expect(storage.deleteOpenProjectAnchorStates).not.toHaveBeenCalled();
    expect(storage.deleteOpenProjectActivityStates).not.toHaveBeenCalled();
    expect(ungrant).not.toHaveBeenCalled();

    await manager.purgeConnection(ROOM_ID, connection.connectionId, false);

    expect(sendStateEvent).toHaveBeenCalledTimes(2);
    expect(storage.deleteOpenProjectAnchorStates).toHaveBeenCalledOnce();
    expect(storage.deleteOpenProjectActivityStates).toHaveBeenCalledOnce();
    expect(ungrant).toHaveBeenCalledOnce();
    expect(manager.getConnectionById(ROOM_ID, connection.connectionId)).toBe(
      undefined,
    );
  });

  it("preserves active anchors when room connections are rebuilt", async () => {
    const storage = {
      deleteOpenProjectAnchorStates: vi.fn().mockResolvedValue(undefined),
      deleteOpenProjectActivityStates: vi.fn().mockResolvedValue(undefined),
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
    expect(storage.deleteOpenProjectActivityStates).not.toHaveBeenCalled();
  });

  it("denies probes for a disabled connection even when anchor cleanup fails", async () => {
    let failCleanup!: (error: Error) => void;
    const cleanup = new Promise<void>((_resolve, reject) => {
      failCleanup = reject;
    });
    const storage = {
      deleteOpenProjectAnchorStates: vi.fn().mockReturnValue(cleanup),
      deleteOpenProjectActivityStates: vi.fn().mockResolvedValue(undefined),
    } as unknown as InstantiateConnectionOpts["storage"];
    const intent = AppserviceMock.create().getIntentForUserId(
      "@openproject:example.test",
    );
    intent.underlyingClient.getRoomStateEventContent = vi
      .fn()
      .mockResolvedValue({});
    const connection = createConnectionState({}, intent, storage);
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
