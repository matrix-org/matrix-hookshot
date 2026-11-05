import { describe, expect, it, vi } from "vitest";

import {
  HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
  HookshotCapabilitiesProbeRequest,
} from "../../src/ToDeviceProtocol";
import {
  OPENPROJECT_ANCHOR_EVENT_KIND,
  OPENPROJECT_EVENT_SCHEMA_VERSION,
} from "../../src/openproject/Schema";
import {
  OpenProjectCapabilityConnection,
  OpenProjectProbeServices,
  createOpenProjectProbeHandler,
} from "../../src/openproject/CapabilityProbe";
import type { OpenProjectAnchorState } from "../../src/openproject/State";

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

type OpenProjectProbeTestServices = OpenProjectProbeServices & {
  evaluateCardActions: OpenProjectCapabilityConnection["evaluateCardActions"];
};

function createServices(
  overrides: Partial<OpenProjectProbeServices> & {
    evaluateCardActions?: OpenProjectCapabilityConnection["evaluateCardActions"];
  } = {},
): OpenProjectProbeTestServices {
  const evaluateCardActions =
    overrides.evaluateCardActions ??
    vi.fn().mockResolvedValue({
      status: "evaluated",
      assignSelf: {
        status: "eligible",
        action: "assign_self",
        workPackageId: 17,
        lockVersion: 1,
        targetHref: "/api/v3/users/7",
      },
      markDone: {
        status: "eligible",
        action: "mark_done",
        workPackageId: 17,
        lockVersion: 1,
        targetHref: "/api/v3/statuses/9",
      },
    });
  const defaultConnections = vi.fn().mockReturnValue([
    {
      connectionId: "connection-1",
      roomId,
      botUserId,
      projectId: 42,
      commandPrefix: "!openproject demo",
      evaluateCardActions,
    },
  ]);
  return {
    getAnchorEvent: vi.fn().mockResolvedValue(validAnchor),
    assertRoomReadAccess: vi.fn().mockResolvedValue(undefined),
    canSendRoomMessage: vi.fn().mockResolvedValue(true),
    hasOpenProjectCommandPermission: vi.fn().mockReturnValue(true),
    getOpenProjectConnections: defaultConnections,
    getOpenProjectAnchorState: vi.fn().mockResolvedValue(activeAnchorState),
    ...overrides,
    evaluateCardActions,
  } as OpenProjectProbeTestServices;
}

describe("authenticated Hookshot probe", () => {
  it("returns only eligible actions with the matched connection's command prefix", async () => {
    const services = createServices();
    const handler = createOpenProjectProbeHandler(services);

    await expect(
      handler(request, { sender, recipientBotUserId: botUserId }),
    ).resolves.toEqual({
      result: "ok",
      connection: "connected",
      actions: [
        {
          id: "assign_self",
          label: "Assign to me",
          command: "!openproject demo assign 17",
        },
        {
          id: "mark_done",
          label: "Mark as done",
          command: "!openproject demo close 17",
        },
      ],
    });

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
    expect(services.evaluateCardActions).toHaveBeenCalledWith(sender, 17);
    expect(services.canSendRoomMessage).toHaveBeenCalledWith(
      sender,
      roomId,
      botUserId,
    );
    expect(services.getOpenProjectConnections).toHaveBeenCalledWith(42);
    expect(services.getOpenProjectAnchorState).toHaveBeenCalledWith(
      "connection-1",
      17,
    );
  });

  it("reports not_connected without exposing token details", async () => {
    const services = createServices({
      evaluateCardActions: vi.fn().mockResolvedValue({
        status: "not_connected",
      }),
    });
    const handler = createOpenProjectProbeHandler(services);

    await expect(
      handler(request, { sender, recipientBotUserId: botUserId }),
    ).resolves.toEqual({
      result: "not_connected",
      connection: "not_connected",
    });
  });

  it("returns an empty action list when both actions are ineligible", async () => {
    const services = createServices({
      evaluateCardActions: vi.fn().mockResolvedValue({
        status: "evaluated",
        assignSelf: { status: "ineligible", reason: "already_assigned" },
        markDone: { status: "stale_target", reason: "configured_status_open" },
      }),
    });
    const handler = createOpenProjectProbeHandler(services);

    await expect(
      handler(request, { sender, recipientBotUserId: botUserId }),
    ).resolves.toEqual({
      result: "ok",
      connection: "connected",
      actions: [],
    });
  });

  it("does not return partial actions when either eligibility check is unavailable", async () => {
    const services = createServices({
      evaluateCardActions: vi.fn().mockResolvedValue({
        status: "evaluated",
        assignSelf: {
          status: "not_authorized",
          reason: "openproject_permission",
        },
        markDone: { status: "unavailable", reason: "openproject_error" },
      }),
    });
    const handler = createOpenProjectProbeHandler(services);

    await expect(
      handler(request, { sender, recipientBotUserId: botUserId }),
    ).resolves.toEqual({ result: "unavailable" });
  });

  it("requires OpenProject command permission", async () => {
    const services = createServices({
      hasOpenProjectCommandPermission: vi.fn().mockReturnValue(false),
    });
    const handler = createOpenProjectProbeHandler(services);

    await expect(
      handler(request, { sender, recipientBotUserId: botUserId }),
    ).resolves.toEqual({ result: "not_authorized" });
    expect(services.canSendRoomMessage).not.toHaveBeenCalled();
    expect(services.evaluateCardActions).not.toHaveBeenCalled();
  });

  it("requires power to send room messages", async () => {
    const services = createServices({
      canSendRoomMessage: vi.fn().mockResolvedValue(false),
    });
    const handler = createOpenProjectProbeHandler(services);

    await expect(
      handler(request, { sender, recipientBotUserId: botUserId }),
    ).resolves.toEqual({ result: "not_authorized" });
    expect(services.evaluateCardActions).not.toHaveBeenCalled();
  });

  it("fails closed if the anchor is replaced during evaluation", async () => {
    const services = createServices({
      getOpenProjectAnchorState: vi
        .fn()
        .mockResolvedValueOnce(activeAnchorState)
        .mockResolvedValueOnce(null),
    });
    const handler = createOpenProjectProbeHandler(services);

    await expect(
      handler(request, { sender, recipientBotUserId: botUserId }),
    ).resolves.toEqual({ result: "not_authorized" });
  });

  it("fails closed if the connection is removed during evaluation", async () => {
    const connections = [
      {
        connectionId: "connection-1",
        roomId,
        botUserId,
        projectId: 42,
        commandPrefix: "!openproject demo",
        evaluateCardActions: vi.fn().mockResolvedValue({
          status: "evaluated",
          assignSelf: { status: "ineligible", reason: "already_assigned" },
          markDone: { status: "ineligible", reason: "already_closed" },
        }),
      },
    ];
    const services = createServices({
      getOpenProjectConnections: vi
        .fn()
        .mockReturnValueOnce(connections)
        .mockReturnValueOnce([]),
    });
    const handler = createOpenProjectProbeHandler(services);

    await expect(
      handler(request, { sender, recipientBotUserId: botUserId }),
    ).resolves.toEqual({ result: "not_authorized" });
  });

  it("uses the current prefix after rechecking the connection", async () => {
    const evaluateCardActions = vi.fn().mockResolvedValue({
      status: "evaluated",
      assignSelf: {
        status: "eligible",
        action: "assign_self",
        workPackageId: 17,
        lockVersion: 1,
        targetHref: "/api/v3/users/7",
      },
      markDone: { status: "ineligible", reason: "already_closed" },
    });
    const connection = {
      connectionId: "connection-1",
      roomId,
      botUserId,
      projectId: 42,
      commandPrefix: "!openproject updated-project",
      evaluateCardActions,
    };
    const services = createServices({
      getOpenProjectConnections: vi
        .fn()
        .mockReturnValueOnce([
          { ...connection, commandPrefix: "!openproject old-project" },
        ])
        .mockReturnValueOnce([connection]),
      evaluateCardActions,
    });
    const handler = createOpenProjectProbeHandler(services);

    await expect(
      handler(request, { sender, recipientBotUserId: botUserId }),
    ).resolves.toEqual({
      result: "ok",
      connection: "connected",
      actions: [
        {
          id: "assign_self",
          label: "Assign to me",
          command: "!openproject updated-project assign 17",
        },
      ],
    });
  });

  it.each([403, 404, 500])(
    "maps anchor lookup HTTP status %i without exposing event details",
    async (status) => {
      const services = createServices({
        getAnchorEvent: vi.fn().mockRejectedValue({ statusCode: status }),
      });
      const handler = createOpenProjectProbeHandler(services);

      await expect(
        handler(request, { sender, recipientBotUserId: botUserId }),
      ).resolves.toEqual({
        result: status === 500 ? "unavailable" : "not_authorized",
      });
    },
  );

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
      const handler = createOpenProjectProbeHandler(services);

      await expect(
        handler(request, { sender, recipientBotUserId: botUserId }),
      ).resolves.toEqual({ result: "not_authorized" });
      expect(services.assertRoomReadAccess).not.toHaveBeenCalled();
      expect(services.evaluateCardActions).not.toHaveBeenCalled();
    },
  );

  it("rejects when the sender is not a room member", async () => {
    const services = createServices({
      assertRoomReadAccess: vi.fn().mockRejectedValue(new Error("not joined")),
    });
    const handler = createOpenProjectProbeHandler(services);

    await expect(
      handler(request, { sender, recipientBotUserId: botUserId }),
    ).resolves.toEqual({ result: "not_authorized" });
    expect(services.evaluateCardActions).not.toHaveBeenCalled();
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
    const handler = createOpenProjectProbeHandler(services);

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
    const handler = createOpenProjectProbeHandler(services);

    await expect(
      handler(request, { sender, recipientBotUserId: botUserId }),
    ).resolves.toEqual({ result: "not_authorized" });
    expect(services.assertRoomReadAccess).not.toHaveBeenCalled();
    expect(services.evaluateCardActions).not.toHaveBeenCalled();
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
    const handler = createOpenProjectProbeHandler(services);

    await expect(
      handler(request, { sender, recipientBotUserId: botUserId }),
    ).resolves.toEqual({ result: "not_authorized" });
    expect(services.assertRoomReadAccess).not.toHaveBeenCalled();
  });

  it("does not handle another integration", async () => {
    const services = createServices();
    const handler = createOpenProjectProbeHandler(services);

    await expect(
      handler(
        { ...request, integration_id: "github" },
        { sender, recipientBotUserId: botUserId },
      ),
    ).resolves.toEqual({ result: "unavailable" });
    expect(services.getAnchorEvent).not.toHaveBeenCalled();
  });
});
