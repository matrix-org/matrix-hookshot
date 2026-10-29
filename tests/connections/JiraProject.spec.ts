import { describe, expect, it, vi } from "vitest";
import type { StateEvent } from "matrix-bot-sdk";
import { ErrCode } from "../../src/api";
import type { BridgeConfig } from "../../src/config/Config";
import { BridgeConfigMessaging } from "../../src/config/sections";
import { JiraProjectConnection } from "../../src/Connections/JiraProject";
import type { InstantiateConnectionOpts } from "../../src/Connections/IConnection";
import type { JiraVersionEvent } from "../../src/jira/WebhookTypes";
import type { UserTokenStore } from "../../src/tokens/UserTokenStore";
import { AppserviceMock } from "../utils/AppserviceMock";

const ROOM_ID = "!jira:example.test";
const USER_ID = "@user:example.test";
const PROJECT_URL = "https://example.atlassian.net/projects/TP";

const VERSION_CREATED: JiraVersionEvent = {
  timestamp: 1745506426948,
  webhookEvent: "version_created",
  version: {
    self: "https://example.atlassian.net/rest/api/2/version/10001",
    id: "10001",
    name: "v1.0.0",
    description: "First release",
    archived: false,
    released: false,
    overdue: false,
    projectId: 10000,
  },
};

function createConnection(
  state: Record<string, unknown> = {},
  messaging = new BridgeConfigMessaging(),
) {
  const appservice = AppserviceMock.create();
  const intent = appservice.getIntentForUserId("@jira:example.test");
  const config = { jira: {}, messaging } as unknown as BridgeConfig;
  const connection = JiraProjectConnection.createConnectionForState(
    ROOM_ID,
    {
      stateKey: PROJECT_URL,
      content: {
        id: "10000",
        url: PROJECT_URL,
        events: ["version_created"],
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
      storage: {} as InstantiateConnectionOpts["storage"],
    },
  );
  return { connection, intent };
}

describe("JiraProjectConnection", () => {
  describe("showUrlPreviews", () => {
    it.each([true, false])(
      "keeps showUrlPreviews=%s when validating state",
      (showUrlPreviews) => {
        expect(
          JiraProjectConnection.validateState({
            url: PROJECT_URL,
            showUrlPreviews,
          }),
        ).toMatchObject({ showUrlPreviews });
      },
    );

    it("rejects a non-boolean showUrlPreviews", () => {
      expect(() =>
        JiraProjectConnection.validateState({
          url: PROJECT_URL,
          showUrlPreviews: "false",
        }),
      ).toThrow(expect.objectContaining({ errcode: ErrCode.BadValue }));
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
          JiraProjectConnection.CanonicalEventType,
          PROJECT_URL,
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
      await connection.onJiraVersionEvent(VERSION_CREATED);

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
      await connection.onJiraVersionEvent(VERSION_CREATED);

      expect(intent.sentEvents).toHaveLength(1);
      expect(
        intent.sentEvents[0].content["com.beeper.linkpreviews"],
      ).toBeUndefined();
    });
  });
});
