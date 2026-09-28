import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import HookshotOpenProjectModule from "../src";
import { OpenProjectMessageRenderer } from "../src/OpenProjectMessageRenderer";
import {
  OPENPROJECT_WORK_PACKAGE_CREATED_EVENT,
  OPENPROJECT_WORK_PACKAGE_UPDATED_EVENT,
  SYNTHETIC_OPENPROJECT_WORK_PACKAGE_CHANGED_EVENT,
} from "./fixtures/OpenProjectEventFixtures";

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

    expect(baseElement.type).toBe(OpenProjectMessageRenderer);
    expect(updateElement.type).toBe(OpenProjectMessageRenderer);
    expect(changedElement.type).toBe(OpenProjectMessageRenderer);

    expect(renderToStaticMarkup(baseElement)).toContain("created");
    expect(renderToStaticMarkup(updateElement)).toContain("created");
    expect(renderToStaticMarkup(changedElement)).toContain("updated");
    expect(renderToStaticMarkup(changedElement)).toContain("Subject changed");
  });
});
