import { describe, expect, it } from "vitest";
import type { OpenProjectContent } from "../src/models/OpenProjectMatrixEventContent";
import { UpdatedMessageViewModel } from "../src/viewmodels/workPackage/UpdatedMessageViewModel";
import { WORK_PACKAGE } from "./fixtures/WorkPackageFixtures";

const WORK_PACKAGE_KEY = "org.matrix.matrix-hookshot.openproject.work_package";
const CHANGED_WORK_PACKAGE_KEY =
  "org.matrix.matrix-hookshot.openproject.work_package.changed";

function createContent(overrides: OpenProjectContent = {}): OpenProjectContent {
  return { [WORK_PACKAGE_KEY]: WORK_PACKAGE, ...overrides };
}

describe("UpdatedMessageViewModel", () => {
  it("preserves the current changed-field precedence in the derived detail", () => {
    const viewModel = new UpdatedMessageViewModel(
      createContent({
        [CHANGED_WORK_PACKAGE_KEY]: {
          assignee: {
            name: "Previous assignee",
            url: "https://openproject.example/users/2",
          },
          priority: { name: "Previous priority", color: "#000000" },
        },
      }),
    ).getSnapshot();

    expect(viewModel?.changedDetail).toEqual({
      kind: "assignee",
      currentName: WORK_PACKAGE.assignee?.name,
    });
  });

  it("derives the current and previous values needed to render status changes", () => {
    const viewModel = new UpdatedMessageViewModel(
      createContent({
        [CHANGED_WORK_PACKAGE_KEY]: {
          status: { name: "New", color: "#000000" },
        },
      }),
    ).getSnapshot();

    expect(viewModel?.changedDetail).toEqual({
      kind: "status",
      previous: { name: "New", color: "#000000" },
      current: {
        name: WORK_PACKAGE.status.name,
        color: WORK_PACKAGE.status.color,
      },
    });
  });

  it("returns null when changed data is missing", () => {
    expect(
      new UpdatedMessageViewModel(createContent()).getSnapshot(),
    ).toBeNull();
  });

  it("creates an updated view model when changed data exists", () => {
    expect(
      new UpdatedMessageViewModel(
        createContent({
          [CHANGED_WORK_PACKAGE_KEY]: { subject: "Previous subject" },
        }),
      ).getSnapshot()?.kind,
    ).toBe("updated");
  });
});
