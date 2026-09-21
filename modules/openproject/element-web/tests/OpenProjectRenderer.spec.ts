import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  type OpenProjectContent,
  WorkPackageCreatedMessage,
  WorkPackageUpdatedMessage,
} from "../src/components/WorkPackageMessage";
import { WorkPackageActions } from "../src/components/WorkPackageActions";
import { WorkPackageChangedDetails } from "../src/components/WorkPackageChangedDetails";
import { WorkPackageDescription } from "../src/components/WorkPackageDescription";
import { WorkPackageLayout } from "../src/components/WorkPackageLayout";
import { WorkPackageLink } from "../src/components/WorkPackageLink";
import { WorkPackageStatus } from "../src/components/WorkPackageStatus";
import { WorkPackageTitle } from "../src/components/WorkPackageTitle";
import {
  createCreatedWorkPackageMessageViewModel,
  createUpdatedWorkPackageMessageViewModel,
} from "../src/viewmodels/WorkPackageMessageViewModel";
import type {
  OpenProjectWorkPackageChanges,
  OpenProjectWorkPackageContent,
} from "../src/models/OpenProjectMatrixEventContent";
import { WORK_PACKAGE } from "./fixtures/WorkPackageFixtures";

const WORK_PACKAGE_KEY = "org.matrix.matrix-hookshot.openproject.work_package";
const CHANGED_WORK_PACKAGE_KEY =
  "org.matrix.matrix-hookshot.openproject.work_package.changed";

type ElementProps = Record<string, unknown>;

function collectElementProps(value: unknown): ElementProps[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectElementProps);
  }
  if (!value || typeof value !== "object") {
    return [];
  }

  const props = (value as { props?: unknown }).props;
  if (!props || typeof props !== "object") {
    return [];
  }

  const elementProps = props as ElementProps;
  return [elementProps, ...collectElementProps(elementProps.children)];
}

function collectText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(collectText).join("");
  }
  if (!value || typeof value !== "object") {
    return "";
  }

  const props = (value as { props?: unknown }).props;
  if (!props || typeof props !== "object") {
    return "";
  }
  return collectText((props as ElementProps).children);
}

function createWorkPackage(
  overrides: Partial<OpenProjectWorkPackageContent> = {},
): OpenProjectWorkPackageContent {
  return { ...WORK_PACKAGE, ...overrides };
}

function createCreatedViewModel(
  overrides: Partial<OpenProjectWorkPackageContent> = {},
) {
  const viewModel = createCreatedWorkPackageMessageViewModel({
    [WORK_PACKAGE_KEY]: createWorkPackage(overrides),
  });
  if (!viewModel) {
    throw new Error("Expected fixture to create a work-package view model");
  }
  return viewModel;
}

function renderChangedDetails(
  changes: OpenProjectWorkPackageChanges,
  overrides: Partial<OpenProjectWorkPackageContent> = {},
): string {
  const viewModel = createUpdatedWorkPackageMessageViewModel({
    [WORK_PACKAGE_KEY]: createWorkPackage(overrides),
    [CHANGED_WORK_PACKAGE_KEY]: changes,
  });
  if (!viewModel?.changedDetail) {
    throw new Error("Expected fixture to create changed work-package details");
  }

  return collectText(
    WorkPackageChangedDetails({
      detail: viewModel.changedDetail,
    }),
  );
}

function createUnsafeData(): OpenProjectContent {
  return {
    [WORK_PACKAGE_KEY]: {
      ...WORK_PACKAGE,
      url: "javascript:alert(document.domain)",
      description: {
        plain: "<img src=x onerror=alert(document.domain)>",
        html: "<img src=x onerror=alert(document.domain)>",
      },
      author: {
        ...WORK_PACKAGE.author,
        url: "data:text/html,<script>alert(1)</script>",
      },
      status: { ...WORK_PACKAGE.status, color: 'url("javascript:alert(1)")' },
      type: { ...WORK_PACKAGE.type, color: "not-a-color" },
    },
    [CHANGED_WORK_PACKAGE_KEY]: {
      description: {
        plain: "<b>Changed description</b>",
      },
      status: {
        name: "Unsafe status",
        color: "rgb(0, 0, 0)",
      },
    },
  };
}

describe("OpenProject renderer security", () => {
  it("renders available descriptions as sanitized HTML", () => {
    const viewModel = createCreatedViewModel({
      description: {
        plain: "Fallback description",
        html: "<p><strong>Rendered description</strong></p>",
      },
    });
    const props = collectElementProps(
      WorkPackageDescription({
        description: viewModel.workPackage.description,
      }),
    );
    const htmlProps = props.find(
      (elementProps) => "dangerouslySetInnerHTML" in elementProps,
    );

    expect(htmlProps?.dangerouslySetInnerHTML).toEqual({
      __html: "<p><strong>Rendered description</strong></p>",
    });
  });

  it("sanitizes descriptions and rejects unsafe links and colors", () => {
    const data = createUnsafeData();
    const viewModel = createCreatedWorkPackageMessageViewModel(data);
    if (!viewModel) {
      throw new Error(
        "Expected unsafe fixture to create a work-package view model",
      );
    }
    const { workPackage } = viewModel;
    const props = [
      ...collectElementProps(
        WorkPackageDescription({ description: workPackage.description }),
      ),
      ...collectElementProps(
        WorkPackageLink({ url: workPackage.url, children: 50 }),
      ),
      ...collectElementProps(WorkPackageTitle({ workPackage })),
      ...collectElementProps(
        WorkPackageLayout({
          borderColor: workPackage.type.color,
          children: null,
        }),
      ),
      ...collectElementProps(WorkPackageStatus({ status: workPackage.status })),
      ...collectElementProps(WorkPackageActions({ url: workPackage.url })),
    ];
    const hrefs = props
      .filter((elementProps) => "href" in elementProps)
      .map((elementProps) => elementProps.href);
    const styles = props
      .filter((elementProps) => "style" in elementProps)
      .map((elementProps) => elementProps.style);

    const descriptionProps = props.find(
      (elementProps) => "dangerouslySetInnerHTML" in elementProps,
    );
    expect(descriptionProps?.dangerouslySetInnerHTML).toEqual({
      __html: "<img />",
    });
    expect(hrefs.every((href) => href === undefined)).toBe(true);
    expect(styles).not.toContainEqual({ background: "#000000" });
    expect(styles).not.toContainEqual({
      background: 'url("javascript:alert(1)")',
    });
  });

  it("sanitizes descriptions used in changed-work-package details", () => {
    const data = createUnsafeData();
    const viewModel = createCreatedWorkPackageMessageViewModel(data);
    if (!viewModel) {
      throw new Error(
        "Expected unsafe fixture to create a work-package view model",
      );
    }
    const props = collectElementProps(
      WorkPackageDescription({
        description: viewModel.workPackage.description,
      }),
    );

    const descriptionProps = props.find(
      (elementProps) => "dangerouslySetInnerHTML" in elementProps,
    );
    expect(descriptionProps?.dangerouslySetInnerHTML).toEqual({
      __html: "<img />",
    });
  });

  it("renders the plain description as text when HTML is unavailable", () => {
    const viewModel = createCreatedViewModel({
      description: { plain: "<b>Plain fallback</b>" },
    });
    const props = collectElementProps(
      WorkPackageDescription({
        description: viewModel.workPackage.description,
      }),
    );

    expect(
      props.some((elementProps) => "dangerouslySetInnerHTML" in elementProps),
    ).toBe(false);
    expect(
      props.some(
        (elementProps) => elementProps.children === "<b>Plain fallback</b>",
      ),
    ).toBe(true);
  });
});

describe("OpenProject public message renderers", () => {
  it("renders a created message through the view-model boundary", () => {
    const markup = renderToStaticMarkup(
      React.createElement(WorkPackageCreatedMessage, {
        data: { [WORK_PACKAGE_KEY]: WORK_PACKAGE },
      }),
    );

    expect(markup).toContain("Work package");
    expect(markup).toContain("created by OpenProject Admin");
    expect(markup).toContain(`#${WORK_PACKAGE.id} ${WORK_PACKAGE.subject}`);
    expect(markup).toContain(`href="${WORK_PACKAGE.url}"`);
  });

  it("renders an updated message through the view-model boundary", () => {
    const workPackage = createWorkPackage({
      status: { name: "In progress", color: "#1098AD" },
    });
    const markup = renderToStaticMarkup(
      React.createElement(WorkPackageUpdatedMessage, {
        data: {
          [WORK_PACKAGE_KEY]: workPackage,
          [CHANGED_WORK_PACKAGE_KEY]: {
            status: { name: "New", color: "#D9D9D9" },
          },
        },
      }),
    );

    expect(markup).toContain("Work package");
    expect(markup).toContain("updated");
    expect(markup).toContain("Status changed from");
    expect(markup).toContain("New");
    expect(markup).toContain("In progress");
  });
});

describe("OpenProject changed-work-package renderer", () => {
  it.each([
    {
      name: "assignee",
      changes: {
        assignee: {
          name: "Grace Hopper",
          url: "https://openproject.example/users/2",
        },
      },
      overrides: {},
      expectedText: "Assignee changed to Alice",
    },
    {
      name: "description",
      changes: { description: { plain: "Previous description" } },
      overrides: {},
      expectedText: "Description changed",
    },
    {
      name: "due date",
      changes: { dueDate: "2026-09-01" },
      overrides: { dueDate: "2026-10-01" },
      expectedText: "Due date changed to 2026-10-01",
    },
    {
      name: "completion percentage",
      changes: { percentageDone: 25 },
      overrides: { percentageDone: 50 },
      expectedText: "Work package is now 50% complete",
    },
    {
      name: "priority",
      changes: { priority: { name: "Normal", color: "#74C0FC" } },
      overrides: { priority: { name: "High", color: "#FF0000" } },
      expectedText: "Priority changed from Normal to High",
    },
    {
      name: "responsible user",
      changes: {
        responsible: {
          name: "Alan Turing",
          url: "https://openproject.example/users/3",
        },
      },
      overrides: {
        responsible: {
          name: "Bob",
          url: "https://openproject.example/users/12",
        },
      },
      expectedText: "Updated accountable person to Bob",
    },
    {
      name: "status",
      changes: { status: { name: "New", color: "#D9D9D9" } },
      overrides: { status: { name: "In progress", color: "#1098AD" } },
      expectedText: "Status changed from",
    },
    {
      name: "subject",
      changes: { subject: "Previous subject" },
      overrides: { subject: "Updated subject" },
      expectedText: "Subject changed",
    },
    {
      name: "type",
      changes: {
        type: { name: "Old task type", color: "#6B7280" },
      },
      overrides: { type: { name: "Task", color: "#1A67A3" } },
      expectedText: "Type changed to Task",
    },
  ] satisfies {
    name: string;
    changes: OpenProjectWorkPackageChanges;
    overrides: Partial<OpenProjectWorkPackageContent>;
    expectedText: string;
  }[])("renders the $name branch", ({ changes, overrides, expectedText }) => {
    expect(renderChangedDetails(changes, overrides)).toContain(expectedText);
  });

  it.each([
    {
      name: "an assignee",
      changes: {
        assignee: {
          name: "Grace Hopper",
          url: "https://openproject.example/users/2",
        },
      },
      overrides: { assignee: undefined },
      expectedText: "Assignee changed to Nobody",
    },
    {
      name: "a responsible user",
      changes: {
        responsible: {
          name: "Alan Turing",
          url: "https://openproject.example/users/3",
        },
      },
      overrides: { responsible: undefined },
      expectedText: "Updated accountable person to Nobody",
    },
    {
      name: "a due date",
      changes: { dueDate: "2026-09-01" },
      overrides: { dueDate: null },
      expectedText: "Due date removed",
    },
    {
      name: "a completion percentage",
      changes: { percentageDone: 25 },
      overrides: { percentageDone: null },
      expectedText: "Work completion percentage removed",
    },
    {
      name: "a priority",
      changes: { priority: { name: "High", color: "#FF0000" } },
      overrides: { priority: undefined },
      expectedText: "Priority changed from High to None",
    },
  ] satisfies {
    name: string;
    changes: OpenProjectWorkPackageChanges;
    overrides: Partial<OpenProjectWorkPackageContent>;
    expectedText: string;
  }[])("renders a cleared $name", ({ changes, overrides, expectedText }) => {
    expect(renderChangedDetails(changes, overrides)).toContain(expectedText);
  });

  it("documents that the current renderer gives assignee changes precedence", () => {
    const text = renderChangedDetails({
      assignee: {
        name: "Grace Hopper",
        url: "https://openproject.example/users/2",
      },
      subject: "Previous subject",
    });

    expect(text).toContain("Assignee changed to Alice");
    expect(text).not.toContain("Subject changed");
  });
});
