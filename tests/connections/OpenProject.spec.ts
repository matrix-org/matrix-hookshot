import { describe, expect, it, vi } from "vitest";
import type { StateEvent } from "matrix-bot-sdk";
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
import { AppserviceMock } from "../utils/AppserviceMock";
import { BASE_URL, WORK_PACKAGE } from "../openproject/WorkPackageFixtures";

const ROOM_ID = "!openproject:example.test";
const USER_ID = "@user:example.test";
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

function createConnection(
  state: Record<string, unknown> = {},
  messaging = new BridgeConfigMessaging(),
) {
  const appservice = AppserviceMock.create();
  const intent = appservice.getIntentForUserId("@openproject:example.test");
  const config = {
    openProject: new BridgeOpenProjectConfig({
      baseUrl: BASE_URL.href,
      webhook: { secret: "secret" },
    }),
    messaging,
  } as unknown as BridgeConfig;

  const connection = OpenProjectConnection.createConnectionForState(
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
      storage: {
        getOpenProjectWorkPackageState: async () => null,
        setOpenProjectWorkPackageState: async () => undefined,
      } as unknown as InstantiateConnectionOpts["storage"],
    },
  );
  return { connection, intent };
}

function createConnectionState(
  state: Record<string, unknown> = {},
): OpenProjectConnection {
  return createConnection(state).connection;
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
  describe("state validation", () => {
    it("accepts a complete state config", () => {
      const connection = createConnectionState({
        events: ALL_EVENTS,
        commandPrefix: "!openproject",
        priority: 5,
      });

      expect(connection.projectId).toBe(1);
      expect(connection.priority).toBe(5);
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
  });

  describe("showUrlPreviews", () => {
    it.each([true, false])(
      "keeps showUrlPreviews=%s from the room state",
      (showUrlPreviews) => {
        const connection = createConnectionState({ showUrlPreviews });

        expect(connection.getProvisionerDetails().config.showUrlPreviews).toBe(
          showUrlPreviews,
        );
      },
    );

    it("rejects a non-boolean showUrlPreviews", () => {
      expectBadValue({ showUrlPreviews: "false" });
    });

    it.each([
      [undefined, false],
      [false, true],
      [true, false],
    ])(
      "saves a showUrlPreviews change from %s to %s to the room state",
      async (from, to) => {
        const { connection, intent } = createConnection({
          showUrlPreviews: from,
        });
        const sendStateEvent = vi.spyOn(
          intent.underlyingClient,
          "sendStateEvent",
        );

        await connection.provisionerUpdateConfig(USER_ID, {
          ...connection.getProvisionerDetails().config,
          showUrlPreviews: to,
        });

        expect(sendStateEvent).toHaveBeenCalledExactlyOnceWith(
          ROOM_ID,
          OpenProjectConnection.CanonicalEventType,
          "state-key",
          expect.objectContaining({ showUrlPreviews: to }),
        );
        expect(connection.getProvisionerDetails().config.showUrlPreviews).toBe(
          to,
        );
      },
    );

    it("disables URL previews on messages after turning showUrlPreviews off", async () => {
      const { connection, intent } = createConnection();

      await connection.provisionerUpdateConfig(USER_ID, {
        ...connection.getProvisionerDetails().config,
        showUrlPreviews: false,
      });
      await connection.onWorkPackageUpdated({
        action: "work_package:updated",
        work_package: WORK_PACKAGE,
      });

      expect(intent.sentEvents).toHaveLength(1);
      expect(intent.sentEvents[0].content["com.beeper.linkpreviews"]).toEqual(
        [],
      );
    });

    it("allows URL previews on messages after turning showUrlPreviews on, even when disabled globally", async () => {
      const { connection, intent } = createConnection(
        { showUrlPreviews: false },
        new BridgeConfigMessaging({ allowUrlPreviews: false }),
      );

      await connection.provisionerUpdateConfig(USER_ID, {
        ...connection.getProvisionerDetails().config,
        showUrlPreviews: true,
      });
      await connection.onWorkPackageUpdated({
        action: "work_package:updated",
        work_package: WORK_PACKAGE,
      });

      expect(intent.sentEvents).toHaveLength(1);
      expect(
        intent.sentEvents[0].content["com.beeper.linkpreviews"],
      ).toBeUndefined();
    });
  });
});
