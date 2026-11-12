// @vitest-environment happy-dom

import * as React from "react";
import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { TooltipProvider } from "@vector-im/compound-web";
import { afterEach, describe, expect, it, vi } from "vitest";
import HookshotOpenProjectModule from "../src";
import { OpenProjectAnchorRenderer } from "../src/OpenProjectAnchorRenderer";
import { AnchorView } from "../src/components/workPackage/AnchorView";
import type {
  OpenProjectAnchor,
  OpenProjectCapabilityAction,
  OpenProjectProbeResponse,
} from "../src/OpenProjectCapabilityClient";
import {
  OPENPROJECT_ANCHOR_EVENT_KIND,
  OPENPROJECT_ANCHOR_STATE_ACTIVE,
  OPENPROJECT_ANCHOR_STATE_INACTIVE,
  OPENPROJECT_EVENT_SCHEMA_VERSION,
} from "../src/OpenProjectSchema";
import { AnchorMessageViewModel } from "../src/viewmodels/workPackage/AnchorMessageViewModel";
import type { OpenProjectAnchorContent } from "../src/models/OpenProjectMatrixEventContent";
import {
  activeAnchorContent,
  activeReplacement,
  anchorEventId,
  inactiveReplacement,
} from "./fixtures/OpenProjectContractFixtures";
import { OPENPROJECT_WORK_PACKAGE_CREATED_EVENT } from "./fixtures/OpenProjectEventFixtures";

const botUserId = "@hookshot_openproject:example.org";

afterEach(cleanup);

const anchor: OpenProjectAnchor = {
  eventId: anchorEventId,
  roomId: "!openproject:example.org",
  snapshotId: "snapshot-1",
  workPackageId: 50,
  recipientUserId: botUserId,
};

function renderAnchor(
  data: OpenProjectAnchorContent,
  capabilityClient: NonNullable<
    React.ComponentProps<typeof OpenProjectAnchorRenderer>["capabilityClient"]
  >,
) {
  return React.createElement(OpenProjectAnchorRenderer, {
    anchor: {
      ...anchor,
      snapshotId: data["org.matrix.matrix-hookshot.openproject.snapshot_id"],
    },
    capabilityClient,
    data,
  });
}

function createProbeResponse(
  result: OpenProjectProbeResponse["result"] = "ok",
  actions?: readonly OpenProjectCapabilityAction[],
): OpenProjectProbeResponse {
  return {
    v: 1,
    request_id: "request-1",
    integration_id: "openproject",
    result,
    ...(result === "ok" ? { connection: "connected" as const } : {}),
    ...(actions === undefined ? {} : { actions: [...actions] }),
  };
}

function createMarkedAnchorEvent(
  sender = botUserId,
  subject = "This is a task",
) {
  return {
    ...OPENPROJECT_WORK_PACKAGE_CREATED_EVENT,
    eventId: "$openproject-anchor-50:example.org",
    roomId: "!openproject:example.org",
    sender,
    content: {
      ...activeAnchorContent,
      "org.matrix.matrix-hookshot.openproject.work_package": {
        ...activeAnchorContent[
          "org.matrix.matrix-hookshot.openproject.work_package"
        ],
        subject,
      },
      "org.matrix.matrix-hookshot.openproject.schema_version":
        OPENPROJECT_EVENT_SCHEMA_VERSION,
      "org.matrix.matrix-hookshot.openproject.event_kind":
        OPENPROJECT_ANCHOR_EVENT_KIND,
      "org.matrix.matrix-hookshot.openproject.anchor_state":
        OPENPROJECT_ANCHOR_STATE_ACTIVE,
      "org.matrix.matrix-hookshot.openproject.snapshot_id": "snapshot-1",
    },
  };
}

function createModuleRegistration() {
  const registerMessageRenderer = vi.fn();
  const insertPlaintextIntoComposer = vi.fn();
  const sendComposerMessage = vi.fn();
  const api = {
    config: {
      get: () => ({
        "org.matrix.matrix-hookshot": {
          integrationBots: { openproject: botUserId },
        },
      }),
    },
    composer: { insertPlaintextIntoComposer, sendComposerMessage },
    customComponents: { registerMessageRenderer },
  } as unknown as ConstructorParameters<typeof HookshotOpenProjectModule>[0];

  return {
    registerMessageRenderer,
    insertPlaintextIntoComposer,
    sendComposerMessage,
    load: () => new HookshotOpenProjectModule(api).load(),
  };
}

describe("OpenProject marked anchor path", () => {
  it("routes a configured, sender-matched anchor through the probe card", async () => {
    const { registerMessageRenderer, load } = createModuleRegistration();
    await load();
    const [, render] = registerMessageRenderer.mock.calls[0];

    const rendered = render({ mxEvent: createMarkedAnchorEvent() });

    expect(rendered.type).toBe(OpenProjectAnchorRenderer);
    expect(rendered.props.capabilityClient).toBeDefined();
    expect(rendered.props.onActionCommand).toEqual(expect.any(Function));
  });

  it("inserts the exact action command into the room composer without sending", async () => {
    const {
      registerMessageRenderer,
      insertPlaintextIntoComposer,
      sendComposerMessage,
      load,
    } = createModuleRegistration();
    await load();
    const [, renderAnchorMessage] = registerMessageRenderer.mock.calls[0];
    const rendered = renderAnchorMessage({
      mxEvent: createMarkedAnchorEvent(),
    });
    const command = "!openproject project assign 50";
    const capabilityClient = {
      getSessionIdentity: () => ({
        userId: "@alice:example.org",
        deviceId: "ALICEDEVICE",
      }),
      isSessionIdentityCurrent: () => true,
      probe: vi
        .fn()
        .mockResolvedValue(
          createProbeResponse("ok", [
            { id: "assign_self", label: "Assign to me", command },
          ]),
        ),
    } as never;
    const viewModel = new AnchorMessageViewModel({
      anchor: rendered.props.anchor,
      capabilityClient,
      data: rendered.props.data,
      onActionCommand: rendered.props.onActionCommand,
    });

    render(
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(AnchorView, { vm: viewModel }),
      ),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Assign to me" }),
    );
    expect(screen.queryByRole("button", { name: "Mark as done" })).toBeNull();

    await waitFor(() => {
      expect(insertPlaintextIntoComposer).toHaveBeenCalledWith(command, {
        view: "room",
      });
    });
    expect(sendComposerMessage).not.toHaveBeenCalled();
  });

  it("does not probe a marked card from another sender", async () => {
    const { registerMessageRenderer, load } = createModuleRegistration();
    await load();
    const [, render] = registerMessageRenderer.mock.calls[0];

    const rendered = render({
      mxEvent: createMarkedAnchorEvent("@spoofed:example.org"),
    });

    expect(rendered.type).toBe(OpenProjectAnchorRenderer);
    expect(rendered.props.capabilityClient).toBeUndefined();
    expect(rendered.props.anchor.eventId).toBe(
      "$openproject-anchor-50:example.org",
    );
  });

  it("does not route versioned anchors without a valid snapshot ID", async () => {
    const { registerMessageRenderer, load } = createModuleRegistration();
    await load();
    const [shouldRender] = registerMessageRenderer.mock.calls[0];
    const event = createMarkedAnchorEvent();
    const contentWithoutSnapshotId = { ...event.content };
    Reflect.deleteProperty(
      contentWithoutSnapshotId,
      "org.matrix.matrix-hookshot.openproject.snapshot_id",
    );

    expect(shouldRender({ ...event, content: contentWithoutSnapshotId })).toBe(
      false,
    );
    expect(
      shouldRender({
        ...event,
        content: {
          ...event.content,
          "org.matrix.matrix-hookshot.openproject.work_package": undefined,
        },
      }),
    ).toBe(false);
    expect(
      shouldRender({
        ...event,
        content: {
          ...event.content,
          "org.matrix.matrix-hookshot.openproject.snapshot_id": "   ",
        },
      }),
    ).toBe(false);
    expect(
      shouldRender({
        ...event,
        content: {
          ...event.content,
          "org.matrix.matrix-hookshot.openproject.snapshot_id": "x".repeat(256),
        },
      }),
    ).toBe(false);
  });

  it("passes the original event ID with effective replacement content", async () => {
    const { registerMessageRenderer, load } = createModuleRegistration();
    await load();
    const [, render] = registerMessageRenderer.mock.calls[0];
    const original = createMarkedAnchorEvent(botUserId, "This is a task");
    const effectiveContent = {
      ...original.content,
      "org.matrix.matrix-hookshot.openproject.snapshot_id": "snapshot-2",
      body: "This is an updated task from m.new_content",
      "org.matrix.matrix-hookshot.openproject.work_package": {
        ...original.content[
          "org.matrix.matrix-hookshot.openproject.work_package"
        ],
        subject: "This is an updated task from m.new_content",
      },
    };
    const replacementEvent = {
      ...original,
      content: {
        msgtype: "m.notice",
        body: "* This is an updated task from m.new_content",
        "m.new_content": effectiveContent,
        "m.relates_to": {
          rel_type: "m.replace",
          event_id: original.eventId,
        },
      },
    };

    const rendered = render({
      // Element exposes the effective m.new_content to module renderers while
      // retaining the original event ID used for capability requests.
      mxEvent: { ...replacementEvent, content: effectiveContent },
    });

    expect(rendered.type).toBe(OpenProjectAnchorRenderer);
    expect(rendered.props.anchor.eventId).toBe(
      "$openproject-anchor-50:example.org",
    );
    expect(
      rendered.props.data["org.matrix.matrix-hookshot.openproject.work_package"]
        .subject,
    ).toBe("This is an updated task from m.new_content");
  });

  it("does not probe an inactive anchor even when a client is supplied", () => {
    const probe = vi.fn();
    const event = createMarkedAnchorEvent();
    const inactiveContent = {
      ...event.content,
      "org.matrix.matrix-hookshot.openproject.anchor_state":
        OPENPROJECT_ANCHOR_STATE_INACTIVE,
      "org.matrix.matrix-hookshot.openproject.snapshot_id": "snapshot-2",
    };

    const viewModel = new AnchorMessageViewModel({
      anchor: {
        eventId: event.eventId,
        roomId: event.roomId,
        snapshotId: "snapshot-2",
        workPackageId: 50,
        recipientUserId: botUserId,
      },
      capabilityClient: {
        probe,
        getSessionIdentity: () => ({
          userId: "@alice:example.org",
          deviceId: "ALICEDEVICE",
        }),
        isSessionIdentityCurrent: () => true,
      } as never,
      data: inactiveContent,
    });

    expect(viewModel.getSnapshot()?.anchor.state).toBe("inactive");
    expect(viewModel.getSnapshot()?.probe).toEqual({ kind: "disabled" });
    expect(probe).not.toHaveBeenCalled();
  });

  it("ignores an active probe result after its view model is disposed", async () => {
    let resolveProbe!: (response: { result: "ok" }) => void;
    const pendingProbe = new Promise<{ result: "ok" }>((resolve) => {
      resolveProbe = resolve;
    });
    const probe = vi.fn(() => pendingProbe);
    const event = createMarkedAnchorEvent();
    const viewModel = new AnchorMessageViewModel({
      anchor: {
        eventId: event.eventId,
        roomId: event.roomId,
        snapshotId:
          event.content["org.matrix.matrix-hookshot.openproject.snapshot_id"],
        workPackageId: 50,
        recipientUserId: botUserId,
      },
      capabilityClient: {
        probe,
        getSessionIdentity: () => ({
          userId: "@alice:example.org",
          deviceId: "ALICEDEVICE",
        }),
        isSessionIdentityCurrent: () => true,
      } as never,
      data: event.content,
    });

    expect(probe).toHaveBeenCalledOnce();
    expect(viewModel.getSnapshot()?.probe).toEqual({ kind: "loading" });
    viewModel.dispose();
    resolveProbe({ result: "ok" });
    await pendingProbe;
    await Promise.resolve();

    expect(viewModel.getSnapshot()?.probe).toEqual({ kind: "loading" });
  });

  it.each([
    ["an ok response without actions", createProbeResponse("ok")],
    ["an ok response with no actions", createProbeResponse("ok", [])],
    ["a not-connected response", createProbeResponse("not_connected")],
    ["a not-authorized response", createProbeResponse("not_authorized")],
    ["an unavailable response", createProbeResponse("unavailable")],
  ])("shows no action buttons for %s", async (_description, response) => {
    const probe = vi.fn().mockResolvedValue(response);
    const capabilityClient = {
      probe,
      getSessionIdentity: () => ({
        userId: "@alice:example.org",
        deviceId: "ALICEDEVICE",
      }),
      isSessionIdentityCurrent: () => true,
    } as never;
    render(renderAnchor(activeAnchorContent, capabilityClient));

    expect(
      await screen.findByRole("link", { name: "View package" }),
    ).toBeTruthy();
    await waitFor(() => expect(probe).toHaveBeenCalledOnce());
    expect(screen.queryByRole("button", { name: "Assign to me" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Mark as done" })).toBeNull();
  });

  it("retries an unavailable probe and displays its newly authorized action", async () => {
    const probe = vi
      .fn()
      .mockResolvedValueOnce(createProbeResponse("unavailable"))
      .mockResolvedValueOnce(
        createProbeResponse("ok", [
          {
            id: "mark_done",
            label: "Mark as done",
            command: "!openproject project close 50",
          },
        ]),
      );
    const capabilityClient = {
      probe,
      getSessionIdentity: () => ({
        userId: "@alice:example.org",
        deviceId: "ALICEDEVICE",
      }),
      isSessionIdentityCurrent: () => true,
    } as never;
    render(renderAnchor(activeAnchorContent, capabilityClient));

    fireEvent.click(
      await screen.findByRole("button", {
        name: "OpenProject connection unavailable. Click to retry.",
      }),
    );

    expect(
      await screen.findByRole("button", { name: "Mark as done" }),
    ).toBeTruthy();
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("ignores a capability result from the previous replacement", async () => {
    let resolveOriginal!: (response: OpenProjectProbeResponse) => void;
    let resolveReplacement!: (response: OpenProjectProbeResponse) => void;
    const originalProbe = new Promise<OpenProjectProbeResponse>((resolve) => {
      resolveOriginal = resolve;
    });
    const replacementProbe = new Promise<OpenProjectProbeResponse>(
      (resolve) => {
        resolveReplacement = resolve;
      },
    );
    const probe = vi
      .fn()
      .mockReturnValueOnce(originalProbe)
      .mockReturnValueOnce(replacementProbe);
    const capabilityClient = {
      probe,
      getSessionIdentity: () => ({
        userId: "@alice:example.org",
        deviceId: "ALICEDEVICE",
      }),
      isSessionIdentityCurrent: () => true,
    } as never;
    const { rerender } = render(
      renderAnchor(activeAnchorContent, capabilityClient),
    );
    const replacementContent = activeReplacement[
      "m.new_content"
    ] as OpenProjectAnchorContent;
    rerender(renderAnchor(replacementContent, capabilityClient));

    expect(probe).toHaveBeenCalledTimes(2);
    expect(probe).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        eventId: anchorEventId,
        snapshotId:
          activeAnchorContent[
            "org.matrix.matrix-hookshot.openproject.snapshot_id"
          ],
      }),
    );
    expect(probe).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        eventId: anchorEventId,
        snapshotId:
          replacementContent[
            "org.matrix.matrix-hookshot.openproject.snapshot_id"
          ],
      }),
    );

    await act(async () => {
      resolveOriginal(
        createProbeResponse("ok", [
          {
            id: "assign_self",
            label: "Assign to me",
            command: "!openproject project assign 50",
          },
        ]),
      );
      await originalProbe;
    });
    expect(screen.queryByRole("button", { name: "Assign to me" })).toBeNull();

    await act(async () => {
      resolveReplacement(
        createProbeResponse("ok", [
          {
            id: "mark_done",
            label: "Mark as done",
            command: "!openproject project close 50",
          },
        ]),
      );
      await replacementProbe;
    });
    expect(
      await screen.findByRole("button", { name: "Mark as done" }),
    ).toBeTruthy();
  });

  it("refreshes a mounted card for active and inactive replacement content", () => {
    const originalSnapshotId =
      activeAnchorContent["org.matrix.matrix-hookshot.openproject.snapshot_id"];
    const activeContent = activeReplacement[
      "m.new_content"
    ] as OpenProjectAnchorContent;
    const activeSnapshotId =
      activeContent["org.matrix.matrix-hookshot.openproject.snapshot_id"];
    const inactiveContent = inactiveReplacement[
      "m.new_content"
    ] as OpenProjectAnchorContent;
    const inactiveSnapshotId =
      inactiveContent["org.matrix.matrix-hookshot.openproject.snapshot_id"];
    const probe = vi.fn(() => new Promise(() => {}));
    const capabilityClient = {
      probe,
      getSessionIdentity: () => ({
        userId: "@alice:example.org",
        deviceId: "ALICEDEVICE",
      }),
      isSessionIdentityCurrent: () => true,
    } as never;
    const { rerender } = render(
      renderAnchor(activeAnchorContent, capabilityClient),
    );

    expect(originalSnapshotId).toBe("00000000-0000-4000-8000-000000000001");
    expect(screen.getByText("Build the bridge")).toBeTruthy();
    expect(screen.getByText("New")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View package" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Assign to me" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Mark as done" })).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "Checking OpenProject connection...",
      }),
    ).toBeTruthy();
    expect(probe).toHaveBeenCalledOnce();

    expect(activeSnapshotId).not.toBe(originalSnapshotId);
    rerender(renderAnchor(activeContent, capabilityClient));
    expect(screen.getByText("Build the updated bridge")).toBeTruthy();
    expect(screen.getByText("Closed")).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Checking OpenProject connection...",
      }),
    ).toBeTruthy();
    expect(probe).toHaveBeenCalledTimes(2);

    expect(inactiveSnapshotId).not.toBe(activeSnapshotId);
    rerender(renderAnchor(inactiveContent, capabilityClient));
    expect(screen.getByText(/removed from timeline/)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Demo project · #50" }),
    ).toBeTruthy();
    expect(screen.queryByText("Build the updated bridge")).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: "Checking OpenProject connection...",
      }),
    ).toBeNull();
    expect(screen.queryByRole("link", { name: "View package" })).toBeNull();
    expect(probe).toHaveBeenCalledTimes(2);
  });
});
