import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import HookshotOpenProjectModule from "../src";
import { OpenProjectAnchorRenderer } from "../src/OpenProjectAnchorRenderer";
import { OpenProjectUpdateRenderer } from "../src/OpenProjectUpdateRenderer";
import {
  OPENPROJECT_ANCHOR_EVENT_KIND,
  OPENPROJECT_ANCHOR_STATE_INACTIVE,
  OPENPROJECT_EVENT_SCHEMA_VERSION,
  OPENPROJECT_UPDATE_EVENT_KIND,
} from "../src/OpenProjectSchema";
import {
  OPENPROJECT_WORK_PACKAGE_CREATED_EVENT,
  OPENPROJECT_WORK_PACKAGE_UPDATED_EVENT,
  SYNTHETIC_OPENPROJECT_WORK_PACKAGE_CHANGED_EVENT,
} from "./fixtures/OpenProjectEventFixtures";

const WORK_PACKAGE_KEY = "org.matrix.matrix-hookshot.openproject.work_package";

function createInactiveAnchorEvent() {
  return {
    ...OPENPROJECT_WORK_PACKAGE_CREATED_EVENT,
    content: {
      ...OPENPROJECT_WORK_PACKAGE_CREATED_EVENT.content,
      "org.matrix.matrix-hookshot.openproject.schema_version":
        OPENPROJECT_EVENT_SCHEMA_VERSION,
      "org.matrix.matrix-hookshot.openproject.event_kind":
        OPENPROJECT_ANCHOR_EVENT_KIND,
      "org.matrix.matrix-hookshot.openproject.anchor_state":
        OPENPROJECT_ANCHOR_STATE_INACTIVE,
    },
  };
}

function createUpdateEvent() {
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
        id: 41,
        subject: "This is an updated task",
        url: "https://elementio-demo.openproject.com/projects/demo-project/work_packages/41",
      },
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

  it("registers a non-editable message renderer", async () => {
    const { registerMessageRenderer, load } = createModuleRegistration();

    await load();

    expect(registerMessageRenderer).toHaveBeenCalledOnce();
    expect(registerMessageRenderer).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      { allowEditingEvent: false },
    );
  });

  it("only selects schema-marked OpenProject room messages", async () => {
    const { registerMessageRenderer, load } = createModuleRegistration();
    await load();
    const [shouldRender] = registerMessageRenderer.mock.calls[0];

    expect(shouldRender(createInactiveAnchorEvent())).toBe(true);
    expect(shouldRender(createUpdateEvent())).toBe(true);
    expect(shouldRender(OPENPROJECT_WORK_PACKAGE_CREATED_EVENT)).toBe(false);
    expect(shouldRender(OPENPROJECT_WORK_PACKAGE_UPDATED_EVENT)).toBe(false);
    expect(shouldRender({ type: "m.room.message", content: {} })).toBe(false);
    expect(
      shouldRender({
        type: "m.room.member",
        content: { [WORK_PACKAGE_KEY]: {} },
      }),
    ).toBe(false);
  });

  it("does not claim legacy work-package events", async () => {
    const { registerMessageRenderer, load } = createModuleRegistration();
    await load();
    const [shouldRender] = registerMessageRenderer.mock.calls[0];

    expect(shouldRender(OPENPROJECT_WORK_PACKAGE_CREATED_EVENT)).toBe(false);
    expect(shouldRender(OPENPROJECT_WORK_PACKAGE_UPDATED_EVENT)).toBe(false);
    expect(shouldRender(SYNTHETIC_OPENPROJECT_WORK_PACKAGE_CHANGED_EVENT)).toBe(
      false,
    );
  });

  it("renders inactive anchors as header-only cards", async () => {
    const { registerMessageRenderer, load } = createModuleRegistration();
    await load();
    const [, render] = registerMessageRenderer.mock.calls[0];

    const rendered = render({ mxEvent: createInactiveAnchorEvent() });

    expect(rendered.type).toBe(OpenProjectAnchorRenderer);
    const markup = renderToStaticMarkup(rendered);
    expect(markup).toContain("(removed from timeline)");
    expect(markup).not.toContain("This is a task");
    expect(markup).not.toContain("View package");
  });

  it("renders update events without a capability renderer", async () => {
    const { registerMessageRenderer, load } = createModuleRegistration();
    await load();
    const [, render] = registerMessageRenderer.mock.calls[0];

    const rendered = render({ mxEvent: createUpdateEvent() });

    expect(rendered.type).toBe(OpenProjectUpdateRenderer);
    expect(rendered.props).not.toHaveProperty("capabilityClient");
  });
});
