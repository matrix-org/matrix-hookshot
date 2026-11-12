import { describe, expect, it, vi } from "vitest";

import {
  HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
  HookshotCapabilitiesProbeRequest,
} from "../src/ToDeviceProtocol";
import {
  OPENPROJECT_ANCHOR_EVENT_KIND,
  OPENPROJECT_EVENT_SCHEMA_VERSION,
} from "../src/openproject/Schema";
import {
  AuthenticatedProbeServices,
  createAuthenticatedProbeHandler,
} from "../src/AuthenticatedProbeHandler";
import type { OpenProjectAnchorState } from "../src/openproject/State";

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
      OPENPROJECT_EVENT_SCHEMA_VERSION,
    "org.matrix.matrix-hookshot.openproject.event_kind":
      OPENPROJECT_ANCHOR_EVENT_KIND,
    "org.matrix.matrix-hookshot.openproject.project": {
      id: 42,
    },
    "org.matrix.matrix-hookshot.openproject.work_package": {
      id: 17,
    },
    "org.matrix.matrix-hookshot.openproject.anchor_state": "active",
  },
};

const activeAnchorState = {
  anchorEventId,
  lockVersion: 1,
  lastContent: validAnchor.content,
} as OpenProjectAnchorState;

function createServices(
  overrides: Partial<AuthenticatedProbeServices> = {},
): AuthenticatedProbeServices {
  return {
    getAnchorEvent: vi.fn().mockResolvedValue(validAnchor),
    assertRoomReadAccess: vi.fn().mockResolvedValue(undefined),
    getOpenProjectForUser: vi.fn().mockResolvedValue({}),
    getOpenProjectConnections: vi
      .fn()
      .mockReturnValue([{ connectionId: "connection-1", roomId, botUserId }]),
    getOpenProjectAnchorState: vi.fn().mockResolvedValue(activeAnchorState),
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
    expect(services.getOpenProjectAnchorState).toHaveBeenCalledWith(
      "connection-1",
      17,
    );
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

  it("rejects an inactive Matrix anchor even when stored state is stale", async () => {
    const services = createServices({
      getAnchorEvent: vi.fn().mockResolvedValue({
        ...validAnchor,
        content: {
          ...validAnchor.content,
          "org.matrix.matrix-hookshot.openproject.anchor_state": "inactive",
        },
      }),
    });
    const handler = createAuthenticatedProbeHandler(services);

    await expect(
      handler(request, { sender, recipientBotUserId: botUserId }),
    ).resolves.toEqual({ result: "not_authorized" });
    expect(services.getOpenProjectAnchorState).not.toHaveBeenCalled();
  });

  it("rejects when the room connection belongs to another Hookshot bot", async () => {
    const services = createServices({
      getOpenProjectConnections: vi.fn().mockReturnValue([
        {
          connectionId: "c1",
          roomId,
          botUserId: "@other-hookshot:example.org",
        },
      ]),
    });
    const handler = createAuthenticatedProbeHandler(services);

    await expect(
      handler(request, { sender, recipientBotUserId: botUserId }),
    ).resolves.toEqual({ result: "not_authorized" });
    expect(services.assertRoomReadAccess).not.toHaveBeenCalled();
    expect(services.getOpenProjectForUser).not.toHaveBeenCalled();
  });

  const staleAnchorCases: Array<[string, OpenProjectAnchorState | null]> = [
    ["missing active anchor", null],
    [
      "inactive stored anchor",
      {
        ...activeAnchorState,
        lastContent: {
          ...validAnchor.content,
          "org.matrix.matrix-hookshot.openproject.anchor_state": "inactive",
        } as unknown as OpenProjectAnchorState["lastContent"],
      },
    ],
    ["historical anchor", { ...activeAnchorState, anchorEventId: "$old" }],
    ["superseded anchor", { ...activeAnchorState, anchorEventId: "$new" }],
    [
      "stored content for another work package",
      {
        ...activeAnchorState,
        lastContent: {
          ...validAnchor.content,
          "org.matrix.matrix-hookshot.openproject.work_package": { id: 18 },
        } as OpenProjectAnchorState["lastContent"],
      },
    ],
  ];

  it.each(staleAnchorCases)("rejects an %s", async (_description, state) => {
    const services = createServices({
      getOpenProjectAnchorState: vi.fn().mockResolvedValue(state),
    });
    const handler = createAuthenticatedProbeHandler(services);

    await expect(
      handler(request, { sender, recipientBotUserId: botUserId }),
    ).resolves.toEqual({ result: "not_authorized" });
    expect(services.assertRoomReadAccess).not.toHaveBeenCalled();
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
