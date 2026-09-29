import { describe, expect, it } from "vitest";
import type { OpenProjectContent } from "../src/models/OpenProjectMatrixEventContent";
import { CreatedMessageViewModel } from "../src/viewmodels/workPackage/CreatedMessageViewModel";
import { WORK_PACKAGE } from "./fixtures/WorkPackageFixtures";

const WORK_PACKAGE_KEY = "org.matrix.matrix-hookshot.openproject.work_package";

function createContent(overrides: OpenProjectContent = {}): OpenProjectContent {
  return { [WORK_PACKAGE_KEY]: WORK_PACKAGE, ...overrides };
}

describe("CreatedMessageViewModel", () => {
  it("exposes a snapshot for a created work package", () => {
    const viewModel = new CreatedMessageViewModel(createContent());
    const snapshot = viewModel.getSnapshot();

    expect(snapshot).toMatchObject({
      kind: "created",
      header: { action: "created", authorName: WORK_PACKAGE.author.name },
      details: {
        id: WORK_PACKAGE.id,
        subject: WORK_PACKAGE.subject,
        url: WORK_PACKAGE.url,
        author: {
          name: WORK_PACKAGE.author.name,
          url: WORK_PACKAGE.author.url,
        },
        status: {
          name: WORK_PACKAGE.status.name,
          color: WORK_PACKAGE.status.color,
        },
        type: {
          name: WORK_PACKAGE.type.name,
          color: WORK_PACKAGE.type.color,
        },
      },
    });
  });

  it("preserves presentation values for views to validate", () => {
    const viewModel = new CreatedMessageViewModel(
      createContent({
        [WORK_PACKAGE_KEY]: {
          ...WORK_PACKAGE,
          url: "javascript:alert('unsafe')",
          author: { ...WORK_PACKAGE.author, url: "data:text/html,unsafe" },
          status: { ...WORK_PACKAGE.status, color: "rgb(0, 0, 0)" },
          type: { ...WORK_PACKAGE.type, color: "not-a-colour" },
        },
      }),
    );

    expect(viewModel.getSnapshot()?.details).toMatchObject({
      url: "javascript:alert('unsafe')",
      author: { url: "data:text/html,unsafe" },
      status: { color: "rgb(0, 0, 0)" },
      type: { color: "not-a-colour" },
    });
  });

  it("returns null for incomplete messages", () => {
    expect(new CreatedMessageViewModel({}).getSnapshot()).toBeNull();
  });
});
