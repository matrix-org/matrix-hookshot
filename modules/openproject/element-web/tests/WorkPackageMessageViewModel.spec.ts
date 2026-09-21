import { describe, expect, it } from "vitest";
import type { OpenProjectContent } from "../src/models/OpenProjectMatrixEventContent";
import {
  createCreatedWorkPackageMessageViewModel,
  createUpdatedWorkPackageMessageViewModel,
  createWorkPackageMessageViewModel,
} from "../src/viewmodels/WorkPackageMessageViewModel";
import { WORK_PACKAGE } from "./fixtures/WorkPackageFixtures";

const WORK_PACKAGE_KEY = "org.matrix.matrix-hookshot.openproject.work_package";
const CHANGED_WORK_PACKAGE_KEY =
  "org.matrix.matrix-hookshot.openproject.work_package.changed";

function createContent(overrides: OpenProjectContent = {}): OpenProjectContent {
  return { [WORK_PACKAGE_KEY]: WORK_PACKAGE, ...overrides };
}

describe("WorkPackageMessageViewModel", () => {
  it("creates a presentation model for a created work package", () => {
    const viewModel = createCreatedWorkPackageMessageViewModel(createContent());

    expect(viewModel).toMatchObject({
      kind: "created",
      header: { action: "created", authorName: WORK_PACKAGE.author.name },
      workPackage: {
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
        type: { name: WORK_PACKAGE.type.name, color: WORK_PACKAGE.type.color },
      },
    });
  });

  it("normalises unsafe presentation values before they reach a view", () => {
    const viewModel = createCreatedWorkPackageMessageViewModel(
      createContent({
        [WORK_PACKAGE_KEY]: {
          ...WORK_PACKAGE,
          url: "javascript:alert('unsafe')",
          description: {
            plain: "<strong>Plain text remains text</strong>",
            html: '<img src="x" onerror="alert(1)"><strong>Safe text</strong>',
          },
          author: { ...WORK_PACKAGE.author, url: "data:text/html,unsafe" },
          status: { ...WORK_PACKAGE.status, color: "rgb(0, 0, 0)" },
          type: { ...WORK_PACKAGE.type, color: "not-a-colour" },
        },
      }),
    );

    expect(viewModel?.workPackage).toMatchObject({
      url: undefined,
      description: {
        plain: "<strong>Plain text remains text</strong>",
        html: "<img /><strong>Safe text</strong>",
      },
      author: { url: undefined },
      status: { color: undefined },
      type: { color: undefined },
    });
  });

  it("preserves the current changed-field precedence in the derived detail", () => {
    const viewModel = createUpdatedWorkPackageMessageViewModel(
      createContent({
        [CHANGED_WORK_PACKAGE_KEY]: {
          assignee: {
            name: "Previous assignee",
            url: "https://openproject.example/users/2",
          },
          priority: { name: "Previous priority", color: "#000000" },
        },
      }),
    );

    expect(viewModel?.changedDetail).toEqual({
      kind: "assignee",
      currentName: WORK_PACKAGE.assignee?.name,
    });
  });

  it("derives the current and previous values needed to render status changes", () => {
    const viewModel = createUpdatedWorkPackageMessageViewModel(
      createContent({
        [CHANGED_WORK_PACKAGE_KEY]: {
          status: { name: "New", color: "#000000" },
        },
      }),
    );

    expect(viewModel?.changedDetail).toEqual({
      kind: "status",
      previous: { name: "New", color: "#000000" },
      current: {
        name: WORK_PACKAGE.status.name,
        color: WORK_PACKAGE.status.color,
      },
    });
  });

  it("returns null for an incomplete message and selects an updated message when changed data exists", () => {
    expect(createCreatedWorkPackageMessageViewModel({})).toBeNull();
    expect(
      createUpdatedWorkPackageMessageViewModel(createContent()),
    ).toBeNull();
    expect(
      createWorkPackageMessageViewModel(
        createContent({
          [CHANGED_WORK_PACKAGE_KEY]: { subject: "Previous subject" },
        }),
      )?.kind,
    ).toBe("updated");
  });
});
