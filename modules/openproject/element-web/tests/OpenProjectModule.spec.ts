import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import HookshotOpenProjectModule from "../src";
import { OpenProjectAnchorRenderer } from "../src/OpenProjectAnchorRenderer";
import { OpenProjectUpdateRenderer } from "../src/OpenProjectUpdateRenderer";
import {
  OPENPROJECT_EVENT_SCHEMA_VERSION,
  OPENPROJECT_UPDATE_EVENT_KIND,
} from "../src/OpenProjectSchema";
import {
  anchorEventId,
  inactiveReplacement,
} from "./fixtures/OpenProjectContractFixtures";
import {
  OPENPROJECT_WORK_PACKAGE_CREATED_EVENT,
  OPENPROJECT_WORK_PACKAGE_UPDATED_EVENT,
  SYNTHETIC_OPENPROJECT_WORK_PACKAGE_CHANGED_EVENT,
} from "./fixtures/OpenProjectEventFixtures";

function createInactiveAnchorEvent() {
  return {
    ...OPENPROJECT_WORK_PACKAGE_CREATED_EVENT,
    eventId: anchorEventId,
    roomId: "!openproject:example.org",
    content: inactiveReplacement["m.new_content"],
  };
}

function createUpdateEvent({
  workPackageId = 41,
  actorId = 7,
  actorName = "OpenProject User",
  includeActor = true,
}: {
  workPackageId?: number;
  actorId?: number;
  actorName?: string;
  includeActor?: boolean;
} = {}) {
  return {
    ...OPENPROJECT_WORK_PACKAGE_CREATED_EVENT,
    content: {
      msgtype: "m.notice",
      body: "Updated the subject",
      "org.matrix.matrix-hookshot.openproject.schema_version":
        OPENPROJECT_EVENT_SCHEMA_VERSION,
      "org.matrix.matrix-hookshot.openproject.event_kind":
        OPENPROJECT_UPDATE_EVENT_KIND,
      "org.matrix.matrix-hookshot.openproject.work_package": {
        id: workPackageId,
        subject: "This is an updated task",
        url: "https://elementio-demo.openproject.com/projects/demo-project/work_packages/41",
      },
      ...(includeActor
        ? {
            "org.matrix.matrix-hookshot.openproject.actor": {
              id: actorId,
              name: actorName,
            },
          }
        : {}),
      "org.matrix.matrix-hookshot.openproject.changes": ["updated the subject"],
    },
  };
}

function createModuleRegistration() {
  const registerMessageRenderer = vi.fn();
  const api = {
    customComponents: { registerMessageRenderer },
  } as unknown as ConstructorParameters<typeof HookshotOpenProjectModule>[0];

  return {
    registerMessageRenderer,
    load: () => new HookshotOpenProjectModule(api).load(),
  };
}

describe("OpenProject Element Web module", () => {
  it("advertises compatibility with Element Web module API v2 only", () => {
    expect(HookshotOpenProjectModule.moduleApiVersion).toBe("^2.0.0");
  });

  it("registers separate anchor and update renderers with their hints", async () => {
    const { registerMessageRenderer, load } = createModuleRegistration();

    await load();

    expect(registerMessageRenderer).toHaveBeenCalledTimes(2);
    expect(registerMessageRenderer.mock.calls[0][2]).toEqual({
      allowEditingEvent: false,
      renderSenderProfile: false,
    });
    expect(registerMessageRenderer.mock.calls[1][2]).toMatchObject({
      allowEditingEvent: false,
      renderAsInfoMessage: true,
      renderGroupSummary: {
        getKey: expect.any(Function),
        getSummary: expect.any(Function),
      },
    });
  });

  it("selects only validated, versioned anchors and updates", async () => {
    const { registerMessageRenderer, load } = createModuleRegistration();
    await load();
    const [shouldRenderAnchor] = registerMessageRenderer.mock.calls[0];
    const [shouldRenderUpdate] = registerMessageRenderer.mock.calls[1];
    const anchor = createInactiveAnchorEvent();
    const malformedAnchor = {
      ...anchor,
      content: {
        ...anchor.content,
        "org.matrix.matrix-hookshot.openproject.snapshot_id": undefined,
      },
    };
    const update = createUpdateEvent();

    expect(shouldRenderAnchor(anchor)).toBe(true);
    expect(shouldRenderUpdate(update)).toBe(true);
    expect(shouldRenderAnchor(update)).toBe(false);
    expect(shouldRenderUpdate(anchor)).toBe(false);
    expect(shouldRenderAnchor(OPENPROJECT_WORK_PACKAGE_CREATED_EVENT)).toBe(
      false,
    );
    expect(shouldRenderUpdate(OPENPROJECT_WORK_PACKAGE_CREATED_EVENT)).toBe(
      false,
    );
    expect(shouldRenderAnchor(malformedAnchor)).toBe(false);
    expect(shouldRenderUpdate(malformedAnchor)).toBe(false);
    expect(shouldRenderUpdate({ type: "m.room.message", content: {} })).toBe(
      false,
    );
    expect(
      shouldRenderAnchor({
        type: "m.room.member",
        content: anchor.content,
      }),
    ).toBe(false);
    expect(shouldRenderAnchor(OPENPROJECT_WORK_PACKAGE_UPDATED_EVENT)).toBe(
      false,
    );
    expect(shouldRenderUpdate(OPENPROJECT_WORK_PACKAGE_UPDATED_EVENT)).toBe(
      false,
    );
    expect(
      shouldRenderUpdate(SYNTHETIC_OPENPROJECT_WORK_PACKAGE_CHANGED_EVENT),
    ).toBe(false);
  });

  it("renders only the event kind selected by each renderer", async () => {
    const { registerMessageRenderer, load } = createModuleRegistration();
    await load();
    const [, renderAnchor] = registerMessageRenderer.mock.calls[0];
    const [, renderUpdate] = registerMessageRenderer.mock.calls[1];
    const fallback = vi.fn(() => "fallback");

    const anchorRendered = renderAnchor(
      { mxEvent: createInactiveAnchorEvent() },
      fallback,
    );
    expect(anchorRendered.type).toBe(OpenProjectAnchorRenderer);
    const anchorMarkup = renderToStaticMarkup(anchorRendered);
    expect(anchorMarkup).toContain("(removed from timeline)");
    expect(anchorMarkup).not.toContain("Build the updated bridge");
    expect(anchorMarkup).not.toContain("View package");

    const updateRendered = renderUpdate(
      { mxEvent: createUpdateEvent() },
      fallback,
    );
    expect(updateRendered.type).toBe(OpenProjectUpdateRenderer);
    expect(updateRendered.props).not.toHaveProperty("capabilityClient");

    expect(renderAnchor({ mxEvent: createUpdateEvent() }, fallback)).toBe(
      "fallback",
    );
    expect(
      renderUpdate({ mxEvent: createInactiveAnchorEvent() }, fallback),
    ).toBe("fallback");
    expect(fallback).toHaveBeenCalledTimes(2);
  });

  it("groups updates by work package and actor and summarizes each group", async () => {
    const { registerMessageRenderer, load } = createModuleRegistration();
    await load();
    const hints = registerMessageRenderer.mock.calls[1][2];
    const { getKey, getSummary } = hints.renderGroupSummary;
    const firstUpdate = createUpdateEvent();
    const sameGroupUpdate = createUpdateEvent();
    const otherActorUpdate = createUpdateEvent({ actorId: 8 });
    const otherWorkPackageUpdate = createUpdateEvent({ workPackageId: 42 });
    const missingActorUpdate = createUpdateEvent({ includeActor: false });

    expect(getKey(firstUpdate)).toBe(getKey(sameGroupUpdate));
    expect(getKey(firstUpdate)).not.toBe(getKey(otherActorUpdate));
    expect(getKey(firstUpdate)).not.toBe(getKey(otherWorkPackageUpdate));
    expect(getKey(missingActorUpdate)).toContain("-41-");
    expect(getSummary([firstUpdate, sameGroupUpdate])).toBe(
      "OpenProject User made 2 changes to #41",
    );
    expect(getSummary([missingActorUpdate])).toBe(
      "Someone made 1 change to #41",
    );
  });
});
