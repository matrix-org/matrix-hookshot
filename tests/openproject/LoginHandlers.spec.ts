import { describe, expect, it, vi } from "vitest";
import type {
  HookshotLoginStartRequest,
  HookshotLoginStatusRequest,
} from "../../src/ToDeviceProtocol";
import type { HookshotProbeContext } from "../../src/ToDeviceReceiver";
import {
  OpenProjectCapabilityConnection,
  OpenProjectProbeServices,
} from "../../src/openproject/CapabilityProbe";
import {
  createOpenProjectLoginStartHandler,
  createOpenProjectLoginStatusHandler,
  OpenProjectLoginHandlerServices,
} from "../../src/openproject/LoginHandlers";
import { OPENPROJECT_ANCHOR_EVENT_KIND } from "../../src/openproject/Schema";
import { OPENPROJECT_EVENT_SCHEMA_VERSION } from "../../src/openproject/Schema";
import type { OpenProjectAnchorState } from "../../src/openproject/State";

const sender = "@alice:example.org";
const botUserId = "@hookshot:example.org";
const roomId = "!room:example.org";
const anchorEventId = "$anchor";
const context: HookshotProbeContext = {
  sender,
  recipientBotUserId: botUserId,
};

const loginStartRequest: HookshotLoginStartRequest = {
  v: 1,
  request_id: "login-start-1",
  requesting_device_id: "ALICEDEVICE",
  integration_id: "openproject",
  room_id: roomId,
  anchor_event_id: anchorEventId,
};

const loginStatusRequest: HookshotLoginStatusRequest = {
  ...loginStartRequest,
  request_id: "login-status-1",
};

const anchorContent = {
  "org.matrix.matrix-hookshot.openproject.schema_version":
    OPENPROJECT_EVENT_SCHEMA_VERSION,
  "org.matrix.matrix-hookshot.openproject.event_kind":
    OPENPROJECT_ANCHOR_EVENT_KIND,
  "org.matrix.matrix-hookshot.openproject.anchor_state": "active",
  "org.matrix.matrix-hookshot.openproject.project": { id: 42 },
  "org.matrix.matrix-hookshot.openproject.work_package": { id: 17 },
};

const activeAnchorState: OpenProjectAnchorState = {
  anchorEventId,
  lockVersion: 1,
  lastContent:
    anchorContent as unknown as OpenProjectAnchorState["lastContent"],
};

function createServices(
  overrides: Partial<OpenProjectLoginHandlerServices> = {},
): OpenProjectLoginHandlerServices {
  const connection: OpenProjectCapabilityConnection = {
    connectionId: "connection-1",
    roomId,
    botUserId,
    projectId: 42,
    commandPrefix: "!openproject demo",
    evaluateCardActions: vi.fn(),
  };
  const baseServices: OpenProjectProbeServices = {
    getAnchorEvent: vi.fn().mockResolvedValue({
      room_id: roomId,
      sender: botUserId,
      content: anchorContent,
    }),
    assertRoomReadAccess: vi.fn().mockResolvedValue(undefined),
    canSendRoomMessage: vi.fn().mockResolvedValue(true),
    hasOpenProjectCommandPermission: vi.fn().mockReturnValue(true),
    hasOpenProjectLoginPermission: vi.fn().mockReturnValue(true),
    isLoginServiceConfigured: vi.fn().mockReturnValue(true),
    getOpenProjectConnections: vi.fn().mockReturnValue([connection]),
    getOpenProjectAnchorState: vi.fn().mockResolvedValue(activeAnchorState),
  };
  return {
    ...baseServices,
    getOpenProjectToken: vi.fn().mockResolvedValue(null),
    createOAuthState: vi.fn().mockReturnValue("oauth-state"),
    getAuthUrl: vi
      .fn()
      .mockResolvedValue("https://openproject.example.org/oauth/authorize"),
    discardOAuthState: vi.fn(),
    ...overrides,
  };
}

describe("OpenProject login handlers", () => {
  describe("login-start", () => {
    it("creates OAuth state for the Matrix sender and returns the auth URL", async () => {
      const services = createServices();
      const handler = createOpenProjectLoginStartHandler(services);

      await expect(handler(loginStartRequest, context)).resolves.toEqual({
        result: "ready",
        auth_url: "https://openproject.example.org/oauth/authorize",
      });
      expect(services.getOpenProjectToken).toHaveBeenCalledWith(sender);
      expect(services.createOAuthState).toHaveBeenCalledWith(sender);
      expect(services.getAuthUrl).toHaveBeenCalledWith("oauth-state");
    });

    it("rejects requests without login permission", async () => {
      const services = createServices({
        hasOpenProjectLoginPermission: vi.fn().mockReturnValue(false),
      });
      const handler = createOpenProjectLoginStartHandler(services);

      await expect(handler(loginStartRequest, context)).resolves.toEqual({
        result: "not_authorized",
      });
      expect(services.getOpenProjectToken).not.toHaveBeenCalled();
      expect(services.createOAuthState).not.toHaveBeenCalled();
    });

    it("returns unavailable when OAuth is disabled", async () => {
      const services = createServices({
        isLoginServiceConfigured: vi.fn().mockReturnValue(false),
      });
      const handler = createOpenProjectLoginStartHandler(services);

      await expect(handler(loginStartRequest, context)).resolves.toEqual({
        result: "unavailable",
      });
      expect(services.createOAuthState).not.toHaveBeenCalled();
    });

    it("does not create state for a sender who is already connected", async () => {
      const services = createServices({
        getOpenProjectToken: vi.fn().mockResolvedValue("stored-token"),
      });
      const handler = createOpenProjectLoginStartHandler(services);

      await expect(handler(loginStartRequest, context)).resolves.toEqual({
        result: "already_connected",
      });
      expect(services.createOAuthState).not.toHaveBeenCalled();
      expect(services.getAuthUrl).not.toHaveBeenCalled();
    });

    it("rechecks connected state before creating OAuth state", async () => {
      const getOpenProjectToken = vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce("stored-token");
      const services = createServices({ getOpenProjectToken });
      const handler = createOpenProjectLoginStartHandler(services);

      await expect(handler(loginStartRequest, context)).resolves.toEqual({
        result: "already_connected",
      });
      expect(getOpenProjectToken).toHaveBeenCalledTimes(2);
      expect(services.createOAuthState).not.toHaveBeenCalled();
    });

    const invalidAnchorCases: Array<
      [string, { anchorState?: string; currentAnchor?: null; duplicate?: true }]
    > = [
      ["an inactive event anchor", { anchorState: "inactive" }],
      ["a removed current anchor", { currentAnchor: null }],
      ["ambiguous current anchors", { duplicate: true }],
    ];
    it.each(invalidAnchorCases)(
      "fails closed for %s",
      async (_description, options) => {
        const services = createServices();
        if (options.anchorState) {
          vi.mocked(services.getAnchorEvent).mockResolvedValue({
            room_id: roomId,
            sender: botUserId,
            content: {
              ...anchorContent,
              "org.matrix.matrix-hookshot.openproject.anchor_state":
                options.anchorState,
            },
          } as unknown as Awaited<ReturnType<typeof services.getAnchorEvent>>);
        }
        if (options.currentAnchor === null) {
          vi.mocked(services.getOpenProjectAnchorState).mockResolvedValue(null);
        }
        if (options.duplicate) {
          vi.mocked(services.getOpenProjectConnections).mockReturnValue([
            ...services.getOpenProjectConnections(42),
            ...services.getOpenProjectConnections(42),
          ]);
        }
        const handler = createOpenProjectLoginStartHandler(services);

        await expect(handler(loginStartRequest, context)).resolves.toEqual({
          result: "not_authorized",
        });
        expect(services.createOAuthState).not.toHaveBeenCalled();
      },
    );

    it("requires room access, command permission, and room-send power", async () => {
      const cases: Array<Partial<OpenProjectProbeServices>> = [
        {
          assertRoomReadAccess: vi.fn().mockRejectedValue(new Error("denied")),
        },
        { hasOpenProjectCommandPermission: vi.fn().mockReturnValue(false) },
        { canSendRoomMessage: vi.fn().mockResolvedValue(false) },
      ];
      for (const override of cases) {
        const services = createServices(override);
        const handler = createOpenProjectLoginStartHandler(services);

        await expect(handler(loginStartRequest, context)).resolves.toEqual({
          result: "not_authorized",
        });
        expect(services.createOAuthState).not.toHaveBeenCalled();
      }
    });

    it("maps state and URL generation failures to unavailable and discards failed state", async () => {
      const stateFailure = createServices({
        createOAuthState: vi.fn().mockImplementation(() => {
          throw new Error("state unavailable");
        }),
      });
      await expect(
        createOpenProjectLoginStartHandler(stateFailure)(
          loginStartRequest,
          context,
        ),
      ).resolves.toEqual({ result: "unavailable" });

      const urlFailure = createServices({
        getAuthUrl: vi.fn().mockRejectedValue(new Error("URL unavailable")),
      });
      await expect(
        createOpenProjectLoginStartHandler(urlFailure)(
          loginStartRequest,
          context,
        ),
      ).resolves.toEqual({ result: "unavailable" });
      expect(urlFailure.discardOAuthState).toHaveBeenCalledWith("oauth-state");
    });
  });

  describe("connection status", () => {
    it.each([
      ["connected", "stored-token", "connected"],
      ["not connected", null, "not_connected"],
    ] as const)(
      "returns %s without creating OAuth state",
      async (_label, token, result) => {
        const services = createServices({
          getOpenProjectToken: vi.fn().mockResolvedValue(token),
        });
        const handler = createOpenProjectLoginStatusHandler(services);

        await expect(handler(loginStatusRequest, context)).resolves.toEqual({
          result,
        });
        expect(services.createOAuthState).not.toHaveBeenCalled();
        expect(services.getAuthUrl).not.toHaveBeenCalled();
      },
    );

    it("returns unavailable for denied access, disabled OAuth, or storage failure", async () => {
      const cases: Partial<OpenProjectLoginHandlerServices>[] = [
        { hasOpenProjectLoginPermission: vi.fn().mockReturnValue(false) },
        { isLoginServiceConfigured: vi.fn().mockReturnValue(false) },
        {
          getOpenProjectToken: vi
            .fn()
            .mockRejectedValue(new Error("storage unavailable")),
        },
      ];
      for (const override of cases) {
        const services = createServices(override);
        const handler = createOpenProjectLoginStatusHandler(services);

        await expect(handler(loginStatusRequest, context)).resolves.toEqual({
          result: "unavailable",
        });
      }
    });
  });
});
