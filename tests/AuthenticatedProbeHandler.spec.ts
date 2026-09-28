import { describe, expect, it, vi } from "vitest";

import {
  HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
  HookshotCapabilitiesProbeRequest,
} from "../src/ToDeviceProtocol";
import {
  AuthenticatedProbeServices,
  createAuthenticatedProbeHandler,
} from "../src/AuthenticatedProbeHandler";

const sender = "@alice:example.org";
const botUserId = "@hookshot:example.org";
const roomId = "!room:example.org";
const anchorEventId = "$anchor";

const request: HookshotCapabilitiesProbeRequest = {
  v: HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
  request_id: "request-123",
  requesting_device_id: "ELEMENTDEVICE",
  integration_id: "openproject",
  room_id: roomId,
  anchor_event_id: anchorEventId,
};

const validAnchor = {
  room_id: roomId,
  sender: botUserId,
  content: {
    "org.matrix.matrix-hookshot.openproject.schema_version":
      HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
    "org.matrix.matrix-hookshot.openproject.event_kind": "anchor",
    "org.matrix.matrix-hookshot.openproject.project": {
      id: 42,
    },
  },
};

function createServices(
  overrides: Partial<AuthenticatedProbeServices> = {},
): AuthenticatedProbeServices {
  return {
    getAnchorEvent: vi.fn().mockResolvedValue(validAnchor),
    assertRoomReadAccess: vi.fn().mockResolvedValue(undefined),
    getOpenProjectForUser: vi.fn().mockResolvedValue({}),
    getOpenProjectConnections: vi.fn().mockReturnValue([{ roomId }]),
    ...overrides,
  };
}

describe("authenticated Hookshot probe", () => {
  it("returns connected for a room member with an OpenProject connection", async () => {
    const services = createServices();
    const handler = createAuthenticatedProbeHandler(services);

    await expect(
      handler(request, { sender, recipientBotUserId: botUserId }),
    ).resolves.toEqual({ result: "ok", connection: "connected" });

    expect(services.getAnchorEvent).toHaveBeenCalledWith(
      roomId,
      anchorEventId,
      botUserId,
    );
    expect(services.assertRoomReadAccess).toHaveBeenCalledWith(
      sender,
      roomId,
      botUserId,
    );
    expect(services.getOpenProjectForUser).toHaveBeenCalledWith(sender);
    expect(services.getOpenProjectConnections).toHaveBeenCalledWith(42);
  });

  it("reports not_connected without exposing token details", async () => {
    const services = createServices({
      getOpenProjectForUser: vi.fn().mockResolvedValue(null),
    });
    const handler = createAuthenticatedProbeHandler(services);

    await expect(
      handler(request, { sender, recipientBotUserId: botUserId }),
    ).resolves.toEqual({ result: "not_connected" });
  });

  type AnchorPatch = {
    room_id?: string;
    sender?: string;
    content?: unknown;
  };

  const invalidAnchorCases: Array<[string, AnchorPatch, boolean]> = [
    ["an anchor from another sender", { sender: "@other:example.org" }, false],
    ["an anchor from another room", { room_id: "!other:example.org" }, false],
    [
      "an unmarked event",
      {
        content: {
          "org.matrix.matrix-hookshot.openproject.project": { id: 42 },
        },
      },
      false,
    ],
    [
      "an anchor for a missing project connection",
      { content: validAnchor.content },
      true,
    ],
  ];

  it.each(invalidAnchorCases)(
    "rejects %s",
    async (_description, anchorPatch, missingConnection) => {
      const services = createServices({
        getAnchorEvent: vi.fn().mockResolvedValue({
          ...validAnchor,
          ...anchorPatch,
        }),
        ...(missingConnection
          ? {
              getOpenProjectConnections: vi.fn().mockReturnValue([]),
            }
          : {}),
      });
      const handler = createAuthenticatedProbeHandler(services);

      await expect(
        handler(request, { sender, recipientBotUserId: botUserId }),
      ).resolves.toEqual({ result: "not_authorized" });
      expect(services.assertRoomReadAccess).not.toHaveBeenCalled();
      expect(services.getOpenProjectForUser).not.toHaveBeenCalled();
    },
  );

  it("rejects when the sender is not a room member", async () => {
    const services = createServices({
      assertRoomReadAccess: vi.fn().mockRejectedValue(new Error("not joined")),
    });
    const handler = createAuthenticatedProbeHandler(services);

    await expect(
      handler(request, { sender, recipientBotUserId: botUserId }),
    ).resolves.toEqual({ result: "not_authorized" });
    expect(services.getOpenProjectForUser).not.toHaveBeenCalled();
  });

  it("rejects when the room connection belongs to another Hookshot bot", async () => {
    const services = createServices({
      getOpenProjectConnections: vi
        .fn()
        .mockReturnValue([
          { roomId, botUserId: "@other-hookshot:example.org" },
        ]),
    });
    const handler = createAuthenticatedProbeHandler(services);

    await expect(
      handler(request, { sender, recipientBotUserId: botUserId }),
    ).resolves.toEqual({ result: "not_authorized" });
    expect(services.assertRoomReadAccess).not.toHaveBeenCalled();
    expect(services.getOpenProjectForUser).not.toHaveBeenCalled();
  });

  it("does not handle another integration", async () => {
    const services = createServices();
    const handler = createAuthenticatedProbeHandler(services);

    await expect(
      handler(
        { ...request, integration_id: "github" },
        { sender, recipientBotUserId: botUserId },
      ),
    ).resolves.toEqual({ result: "unavailable" });
    expect(services.getAnchorEvent).not.toHaveBeenCalled();
  });
});
