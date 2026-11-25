import { describe, expect, it } from "vitest";
import {
  isHookshotLoginStartRequest,
  isHookshotLoginStatusRequest,
  isHookshotCapabilitiesProbeRequest,
  isVersionedHookshotAnchorEventContent,
  HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
} from "../src/ToDeviceProtocol";
import {
  isHookshotCapabilitiesProbeResponse,
  isHookshotLoginStartResponse,
  isHookshotLoginStatusResponse,
} from "./utils/ToDeviceProtocol";
import {
  OPENPROJECT_ANCHOR_EVENT_KIND,
  OPENPROJECT_EVENT_SCHEMA_VERSION,
} from "../src/openproject/Schema";

const validRequest = {
  v: HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
  request_id: "request-123",
  requesting_device_id: "ELEMENTDEVICE",
  integration_id: "openproject",
  room_id: "!room:example.org",
  anchor_event_id: "$anchor",
};

const validResponse = {
  v: HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
  request_id: "request-123",
  integration_id: "openproject",
  result: "ok",
  connection: "connected",
};

const validLoginRequest = {
  v: HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
  request_id: "2d4e9b5e-09d2-4a9f-881b-8d924fc83c2d",
  requesting_device_id: "ELEMENTDEVICE",
  integration_id: "openproject",
  room_id: "!room:example.org",
  anchor_event_id: "$anchor",
};

const validLoginResponseBase = {
  v: HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
  request_id: validLoginRequest.request_id,
  integration_id: "openproject",
};

describe("Hookshot Step 0 to-device protocol", () => {
  describe("login-start protocol", () => {
    it.each(["openproject", "github", "custom_2"])(
      "accepts a valid request for integration %s",
      (integrationId) => {
        expect(
          isHookshotLoginStartRequest({
            ...validLoginRequest,
            integration_id: integrationId,
          }),
        ).toBe(true);
      },
    );

    it("accepts each exact response variant", () => {
      expect(
        isHookshotLoginStartResponse({
          ...validLoginResponseBase,
          result: "ready",
          auth_url: "https://openproject.example.org/oauth/authorize?state=abc",
        }),
      ).toBe(true);
      for (const result of [
        "already_connected",
        "not_authorized",
        "unavailable",
      ]) {
        expect(
          isHookshotLoginStartResponse({
            ...validLoginResponseBase,
            result,
          }),
        ).toBe(true);
      }
    });

    it("rejects unsupported versions, malformed IDs, and wildcard devices", () => {
      expect(isHookshotLoginStartRequest({ ...validLoginRequest, v: 2 })).toBe(
        false,
      );
      expect(
        isHookshotLoginStartRequest({
          ...validLoginRequest,
          requesting_device_id: "*",
        }),
      ).toBe(false);
      expect(
        isHookshotLoginStartRequest({ ...validLoginRequest, room_id: "room" }),
      ).toBe(false);
      expect(
        isHookshotLoginStartRequest({
          ...validLoginRequest,
          anchor_event_id: "anchor",
        }),
      ).toBe(false);
      expect(
        isHookshotLoginStartRequest({
          ...validLoginRequest,
          integration_id: "OpenProject",
        }),
      ).toBe(false);
    });

    it("rejects unexpected or forbidden request fields and oversized values", () => {
      for (const extra of [
        { user_id: "@alice:example.org" },
        { access_token: "secret" },
        { token: "secret" },
        { auth_url: "https://example.org" },
        { work_package_id: 123 },
        { unexpected: true },
      ]) {
        expect(
          isHookshotLoginStartRequest({ ...validLoginRequest, ...extra }),
        ).toBe(false);
      }
      expect(
        isHookshotLoginStartRequest({
          ...validLoginRequest,
          request_id: "r".repeat(256),
        }),
      ).toBe(false);
    });

    it("requires a bounded absolute HTTP(S) URL only for ready", () => {
      expect(
        isHookshotLoginStartResponse({
          ...validLoginResponseBase,
          result: "ready",
          auth_url: "not-a-url",
        }),
      ).toBe(false);
      expect(
        isHookshotLoginStartResponse({
          ...validLoginResponseBase,
          result: "ready",
          auth_url: "javascript:alert(1)",
        }),
      ).toBe(false);
      expect(
        isHookshotLoginStartResponse({
          ...validLoginResponseBase,
          result: "ready",
          auth_url: `https://example.org/${"a".repeat(2048)}`,
        }),
      ).toBe(false);
      expect(
        isHookshotLoginStartResponse({
          ...validLoginResponseBase,
          result: "unavailable",
          auth_url: "https://example.org",
        }),
      ).toBe(false);
      expect(
        isHookshotLoginStartResponse({
          ...validLoginResponseBase,
          result: "ready",
        }),
      ).toBe(false);
    });
  });

  describe("connection-status protocol", () => {
    it.each(["openproject", "github"])(
      "accepts a valid request for integration %s",
      (integrationId) => {
        expect(
          isHookshotLoginStatusRequest({
            ...validLoginRequest,
            integration_id: integrationId,
          }),
        ).toBe(true);
      },
    );

    it.each(["connected", "not_connected", "unavailable"])(
      "accepts the %s response",
      (result) => {
        expect(
          isHookshotLoginStatusResponse({
            ...validLoginResponseBase,
            result,
          }),
        ).toBe(true);
      },
    );

    it("rejects unsupported versions and forbidden or extra fields", () => {
      expect(isHookshotLoginStatusRequest({ ...validLoginRequest, v: 2 })).toBe(
        false,
      );
      expect(
        isHookshotLoginStatusRequest({
          ...validLoginRequest,
          requesting_device_id: "*",
        }),
      ).toBe(false);
      for (const extra of [
        { user_id: "@alice:example.org" },
        { access_token: "secret" },
        { oauth_state: "secret" },
        { unexpected: true },
      ]) {
        expect(
          isHookshotLoginStatusRequest({ ...validLoginRequest, ...extra }),
        ).toBe(false);
      }
      expect(
        isHookshotLoginStatusRequest({
          ...validLoginRequest,
          anchor_event_id: "x".repeat(256),
        }),
      ).toBe(false);
      expect(
        isHookshotLoginStatusResponse({
          ...validLoginResponseBase,
          result: "connected",
          token: "secret",
        }),
      ).toBe(false);
    });
  });

  describe("probe requests", () => {
    it("accepts the complete request shape", () => {
      expect(isHookshotCapabilitiesProbeRequest(validRequest)).toBe(true);
    });

    it.each([
      ["a body-level Matrix user ID", { user_id: "@alice:example.org" }],
      ["a body-level reply user ID", { reply_user_id: "@alice:example.org" }],
      ["a credential", { access_token: "secret" }],
      ["OpenProject data", { work_package_id: 123 }],
      ["an action context", { action_context: "context" }],
    ])("rejects %s", (_description, extra) => {
      expect(
        isHookshotCapabilitiesProbeRequest({ ...validRequest, ...extra }),
      ).toBe(false);
    });

    it("rejects a wildcard target device", () => {
      expect(
        isHookshotCapabilitiesProbeRequest({
          ...validRequest,
          requesting_device_id: "*",
        }),
      ).toBe(false);
    });

    it("rejects malformed routing and correlation fields", () => {
      expect(
        isHookshotCapabilitiesProbeRequest({
          ...validRequest,
          room_id: "not-a-room-id",
        }),
      ).toBe(false);
      expect(
        isHookshotCapabilitiesProbeRequest({
          ...validRequest,
          anchor_event_id: "not-an-event-id",
        }),
      ).toBe(false);
      expect(
        isHookshotCapabilitiesProbeRequest({
          ...validRequest,
          request_id: "request id",
        }),
      ).toBe(false);
    });

    it.each(["", "OpenProject", "https://example.org", "open project"])(
      "rejects an invalid integration ID: %s",
      (integrationId) => {
        expect(
          isHookshotCapabilitiesProbeRequest({
            ...validRequest,
            integration_id: integrationId,
          }),
        ).toBe(false);
      },
    );

    it("rejects an unsupported protocol version", () => {
      expect(
        isHookshotCapabilitiesProbeRequest({ ...validRequest, v: 2 }),
      ).toBe(false);
    });
  });

  describe("probe responses", () => {
    it("accepts a connected response", () => {
      expect(isHookshotCapabilitiesProbeResponse(validResponse)).toBe(true);
    });

    it("accepts a version-1 response without actions for compatibility", () => {
      expect(isHookshotCapabilitiesProbeResponse({ ...validResponse })).toBe(
        true,
      );
    });

    it("accepts bounded unique actions only on an ok response", () => {
      expect(
        isHookshotCapabilitiesProbeResponse({
          ...validResponse,
          actions: [
            {
              id: "assign_self",
              label: "Assign to me",
              command: "!openproject project assign 123",
            },
            {
              id: "mark_done",
              label: "Mark as done",
              command: "!openproject project close 123",
            },
          ],
        }),
      ).toBe(true);
      expect(
        isHookshotCapabilitiesProbeResponse({
          ...validResponse,
          actions: [
            { id: "assign_self", label: "Assign", command: "!op assign 1" },
            { id: "assign_self", label: "Assign", command: "!op assign 2" },
          ],
        }),
      ).toBe(false);
      expect(
        isHookshotCapabilitiesProbeResponse({
          ...validResponse,
          result: "unavailable",
          connection: undefined,
          actions: [],
        }),
      ).toBe(false);
    });

    it.each(["not_connected", "not_authorized", "unavailable"])(
      "accepts a safe %s result",
      (result) => {
        expect(
          isHookshotCapabilitiesProbeResponse({
            v: HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
            request_id: "request-123",
            integration_id: "openproject",
            result,
          }),
        ).toBe(true);
      },
    );

    it.each(["available", "not_authorized", "unavailable"])(
      "accepts the %s login capability only on not_connected",
      (login) => {
        expect(
          isHookshotCapabilitiesProbeResponse({
            ...validResponse,
            result: "not_connected",
            connection: "not_connected",
            login,
          }),
        ).toBe(true);
        expect(
          isHookshotCapabilitiesProbeResponse({
            ...validResponse,
            login,
          }),
        ).toBe(false);
      },
    );

    it("rejects an unknown login capability value", () => {
      expect(
        isHookshotCapabilitiesProbeResponse({
          ...validResponse,
          result: "not_connected",
          connection: "not_connected",
          login: "login_now",
        }),
      ).toBe(false);
    });

    it.each([
      ["credentials", { oauth_token: "secret" }],
      ["work-package data", { work_package: { id: 123 } }],
      ["a revision", { lock_version: 4 }],
      ["an action context", { action_context: "context" }],
      ["a body-level reply user ID", { user_id: "@alice:example.org" }],
    ])("rejects response content containing %s", (_description, extra) => {
      expect(
        isHookshotCapabilitiesProbeResponse({ ...validResponse, ...extra }),
      ).toBe(false);
    });

    it("rejects an unsupported result or connection state", () => {
      expect(
        isHookshotCapabilitiesProbeResponse({
          ...validResponse,
          result: "assign_self",
        }),
      ).toBe(false);
      expect(
        isHookshotCapabilitiesProbeResponse({
          ...validResponse,
          connection: "authorized",
        }),
      ).toBe(false);
    });

    it("requires safe connection and action combinations", () => {
      expect(
        isHookshotCapabilitiesProbeResponse({
          ...validResponse,
          result: "not_connected",
          connection: "connected",
        }),
      ).toBe(false);
      expect(
        isHookshotCapabilitiesProbeResponse({
          ...validResponse,
          result: "not_authorized",
          connection: "connected",
        }),
      ).toBe(false);
      expect(
        isHookshotCapabilitiesProbeResponse({
          ...validResponse,
          actions: [{ id: "assign_self", label: "Assign", command: "x" }],
        }),
      ).toBe(true);
      expect(
        isHookshotCapabilitiesProbeResponse({
          ...validResponse,
          actions: [{ id: "a", label: "A", command: "bad\ncommand" }],
        }),
      ).toBe(false);
    });
  });

  describe("anchor markers", () => {
    it("accepts versioned anchors for declared integrations", () => {
      const integrationId = "openproject";
      const namespace = `org.matrix.matrix-hookshot.${integrationId}`;
      const anchor = {
        [`${namespace}.schema_version`]: OPENPROJECT_EVENT_SCHEMA_VERSION,
        [`${namespace}.event_kind`]: OPENPROJECT_ANCHOR_EVENT_KIND,
      };

      expect(
        isVersionedHookshotAnchorEventContent(
          anchor,
          integrationId,
          OPENPROJECT_EVENT_SCHEMA_VERSION,
          OPENPROJECT_ANCHOR_EVENT_KIND,
        ),
      ).toBe(true);
    });

    it("does not accept an anchor marker for another integration", () => {
      const anchor = {
        "org.matrix.matrix-hookshot.github.schema_version":
          OPENPROJECT_EVENT_SCHEMA_VERSION,
        "org.matrix.matrix-hookshot.github.event_kind":
          OPENPROJECT_ANCHOR_EVENT_KIND,
      };

      expect(
        isVersionedHookshotAnchorEventContent(
          anchor,
          "openproject",
          OPENPROJECT_EVENT_SCHEMA_VERSION,
          OPENPROJECT_ANCHOR_EVENT_KIND,
        ),
      ).toBe(false);
    });

    it.each([
      ["a legacy event", {}, "openproject"],
      [
        "the wrong schema version",
        {
          "org.matrix.matrix-hookshot.openproject.schema_version":
            OPENPROJECT_EVENT_SCHEMA_VERSION + 1,
          "org.matrix.matrix-hookshot.openproject.event_kind":
            OPENPROJECT_ANCHOR_EVENT_KIND,
        },
        "openproject",
      ],
      [
        "the wrong event kind",
        {
          "org.matrix.matrix-hookshot.openproject.schema_version":
            OPENPROJECT_EVENT_SCHEMA_VERSION,
          "org.matrix.matrix-hookshot.openproject.event_kind": "update",
        },
        "openproject",
      ],
      ["an invalid integration ID", {}, "https://example.org"],
    ])("rejects %s", (_description, value, integrationId) => {
      expect(
        isVersionedHookshotAnchorEventContent(
          value,
          integrationId,
          OPENPROJECT_EVENT_SCHEMA_VERSION,
          OPENPROJECT_ANCHOR_EVENT_KIND,
        ),
      ).toBe(false);
    });
  });
});
