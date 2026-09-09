import { describe, expect, it, vi } from "vitest";
import HookshotOpenProjectModule from "../../../modules/openproject/element-web/src";
import {
  OpenProjectEventWidget,
  OpenProjectEventWidgetChanged,
} from "../../../modules/openproject/element-web/src/components/OpenProject";
import {
  OPENPROJECT_WORK_PACKAGE_CREATED_EVENT,
  OPENPROJECT_WORK_PACKAGE_UPDATED_EVENT,
  SYNTHETIC_OPENPROJECT_WORK_PACKAGE_CHANGED_EVENT,
} from "./OpenProjectEventFixtures";

const WORK_PACKAGE_KEY = "org.matrix.matrix-hookshot.openproject.work_package";

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

  it("only selects room messages containing a work-package payload", async () => {
    const { registerMessageRenderer, load } = createModuleRegistration();
    await load();
    const [shouldRender] = registerMessageRenderer.mock.calls[0];

    expect(shouldRender(OPENPROJECT_WORK_PACKAGE_CREATED_EVENT)).toBe(true);
    expect(shouldRender(OPENPROJECT_WORK_PACKAGE_UPDATED_EVENT)).toBe(true);
    expect(shouldRender({ type: "m.room.message", content: {} })).toBe(false);
    expect(
      shouldRender({
        type: "m.room.member",
        content: { [WORK_PACKAGE_KEY]: {} },
      }),
    ).toBe(false);
  });

  it("uses the changed renderer for synthetic renderer-only input", async () => {
    const { registerMessageRenderer, load } = createModuleRegistration();
    await load();
    const [, render] = registerMessageRenderer.mock.calls[0];

    const baseElement = render({
      mxEvent: OPENPROJECT_WORK_PACKAGE_CREATED_EVENT,
    });
    const updateElement = render({
      mxEvent: OPENPROJECT_WORK_PACKAGE_UPDATED_EVENT,
    });
    const changedElement = render({
      mxEvent: SYNTHETIC_OPENPROJECT_WORK_PACKAGE_CHANGED_EVENT,
    });

    expect(baseElement.type).toBe(OpenProjectEventWidget);
    expect(updateElement.type).toBe(OpenProjectEventWidget);
    expect(changedElement.type).toBe(OpenProjectEventWidgetChanged);
  });
});
