import { describe, expect, it, vi } from "vitest";
import HookshotOpenProjectModule from "../src";
import { OpenProjectAnchorRenderer } from "../src/OpenProjectAnchorRenderer";
import {
  OPENPROJECT_ANCHOR_EVENT_KIND,
  OPENPROJECT_ANCHOR_STATE_ACTIVE,
  OPENPROJECT_ANCHOR_STATE_INACTIVE,
  OPENPROJECT_EVENT_SCHEMA_VERSION,
} from "../src/OpenProjectSchema";
import { AnchorMessageViewModel } from "../src/viewmodels/workPackage/AnchorMessageViewModel";
import { OPENPROJECT_WORK_PACKAGE_CREATED_EVENT } from "./fixtures/OpenProjectEventFixtures";

const botUserId = "@hookshot_openproject:example.org";

function createMarkedAnchorEvent(
  sender = botUserId,
  subject = "This is a task",
) {
  return {
    ...OPENPROJECT_WORK_PACKAGE_CREATED_EVENT,
    eventId: "$openproject-anchor-41:example.org",
    roomId: "!openproject:example.org",
    sender,
    content: {
      ...OPENPROJECT_WORK_PACKAGE_CREATED_EVENT.content,
      "org.matrix.matrix-hookshot.openproject.work_package": {
        ...OPENPROJECT_WORK_PACKAGE_CREATED_EVENT.content[
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
    },
  };
}

function createModuleRegistration() {
  const registerMessageRenderer = vi.fn();
  const api = {
    config: {
      get: () => ({
        "org.matrix.matrix-hookshot": {
          integrationBots: { openproject: botUserId },
        },
      }),
    },
    customComponents: { registerMessageRenderer },
  } as unknown as ConstructorParameters<typeof HookshotOpenProjectModule>[0];

  return {
    registerMessageRenderer,
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
  });

  it("renders marked anchors without a capability client", async () => {
    const { registerMessageRenderer, load } = createModuleRegistration();
    await load();
    const [, render] = registerMessageRenderer.mock.calls[0];
    const event = createMarkedAnchorEvent();
    const {
      ["org.matrix.matrix-hookshot.openproject.anchor_state"]: _,
      ...legacyContent
    } = event.content;

    const rendered = render({ mxEvent: { ...event, content: legacyContent } });

    expect(rendered.type).toBe(OpenProjectAnchorRenderer);
    expect(rendered.props.capabilityClient).toBeUndefined();
  });

  it("passes the original event ID with effective replacement content", async () => {
    const { registerMessageRenderer, load } = createModuleRegistration();
    await load();
    const [, render] = registerMessageRenderer.mock.calls[0];
    const original = createMarkedAnchorEvent(botUserId, "This is a task");
    const effectiveContent = {
      ...original.content,
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
      "$openproject-anchor-41:example.org",
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
    };

    const viewModel = new AnchorMessageViewModel({
      anchor: {
        eventId: event.eventId,
        roomId: event.roomId,
        workPackageId: 41,
        recipientUserId: botUserId,
      },
      capabilityClient: { probe } as never,
      data: inactiveContent,
    });

    expect(viewModel.getSnapshot()?.anchor.state).toBe("inactive");
    expect(viewModel.getSnapshot()?.probe).toEqual({ kind: "disabled" });
    expect(probe).not.toHaveBeenCalled();
  });
});
