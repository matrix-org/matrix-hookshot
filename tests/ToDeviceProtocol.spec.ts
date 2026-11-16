import { describe, expect, it } from "vitest";
import {
  isHookshotCapabilitiesProbeRequest,
  isHookshotCapabilitiesProbeResponse,
  isVersionedHookshotAnchorEventContent,
  HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
} from "../src/ToDeviceProtocol";

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

describe("Hookshot Step 0 to-device protocol", () => {
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
  });

  describe("anchor markers", () => {
    it("accepts versioned anchors for declared integrations", () => {
      const integrationId = "openproject";
      const namespace = `org.matrix.matrix-hookshot.${integrationId}`;
      const anchor = {
        [`${namespace}.schema_version`]: HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
        [`${namespace}.event_kind`]: "anchor",
      };

      expect(isVersionedHookshotAnchorEventContent(anchor, integrationId)).toBe(
        true,
      );
    });

    it("does not accept an anchor marker for another integration", () => {
      const anchor = {
        "org.matrix.matrix-hookshot.github.schema_version":
          HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
        "org.matrix.matrix-hookshot.github.event_kind": "anchor",
      };

      expect(isVersionedHookshotAnchorEventContent(anchor, "openproject")).toBe(
        false,
      );
    });

    it.each([
      ["a legacy event", {}, "openproject"],
      [
        "the wrong schema version",
        {
          "org.matrix.matrix-hookshot.openproject.schema_version": 2,
          "org.matrix.matrix-hookshot.openproject.event_kind": "anchor",
        },
        "openproject",
      ],
      [
        "the wrong event kind",
        {
          "org.matrix.matrix-hookshot.openproject.schema_version":
            HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
          "org.matrix.matrix-hookshot.openproject.event_kind": "update",
        },
        "openproject",
      ],
      ["an invalid integration ID", {}, "https://example.org"],
    ])("rejects %s", (_description, value, integrationId) => {
      expect(isVersionedHookshotAnchorEventContent(value, integrationId)).toBe(
        false,
      );
    });
  });
});
