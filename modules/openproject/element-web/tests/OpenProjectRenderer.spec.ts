import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MockViewModel } from "@element-hq/web-shared-components";
import { OpenProjectMessageRenderer } from "../src/OpenProjectMessageRenderer";
import { CreatedView } from "../src/components/workPackage/CreatedView";
import { UpdatedView } from "../src/components/workPackage/UpdatedView";
import type { OpenProjectContent } from "../src/models/OpenProjectMatrixEventContent";
import { ActionsView } from "../src/components/workPackage/ActionsView";
import { ChangedDetailsView } from "../src/components/workPackage/ChangedDetailsView";
import { DescriptionView } from "../src/components/workPackage/DescriptionView";
import { LayoutView } from "../src/components/workPackage/LayoutView";
import { LinkView } from "../src/components/workPackage/LinkView";
import { StatusView } from "../src/components/workPackage/StatusView";
import { TitleView } from "../src/components/workPackage/TitleView";
import { CreatedMessageViewModel } from "../src/viewmodels/workPackage/CreatedMessageViewModel";
import { UpdatedMessageViewModel } from "../src/viewmodels/workPackage/UpdatedMessageViewModel";
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
  const viewModel = new CreatedMessageViewModel({
    [WORK_PACKAGE_KEY]: createWorkPackage(overrides),
  }).getSnapshot();
  if (!viewModel) {
    throw new Error("Expected fixture to create a work-package view model");
  }
  return viewModel;
}

function renderChangedDetails(
  changes: OpenProjectWorkPackageChanges,
  overrides: Partial<OpenProjectWorkPackageContent> = {},
): string {
  const viewModel = new UpdatedMessageViewModel({
    [WORK_PACKAGE_KEY]: createWorkPackage(overrides),
    [CHANGED_WORK_PACKAGE_KEY]: changes,
  }).getSnapshot();
  if (!viewModel?.changedDetail) {
    throw new Error("Expected fixture to create changed work-package details");
  }

  return collectText(
    ChangedDetailsView({
      change: viewModel.changedDetail,
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
  it("opens work-package links safely in a new tab", () => {
    expect(
      LinkView({
        url: "https://openproject.example/work_packages/50",
        children: 50,
      }).props,
    ).toMatchObject({
      href: "https://openproject.example/work_packages/50",
      target: "_blank",
      rel: "noopener noreferrer",
    });
  });

  it("renders available descriptions as sanitized HTML", () => {
    const viewModel = createCreatedViewModel({
      description: {
        plain: "Fallback description",
        html: "<p><strong>Rendered description</strong></p>",
      },
    });
    const props = collectElementProps(
      DescriptionView({ ...viewModel.details.description }),
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
    const viewModel = new CreatedMessageViewModel(data).getSnapshot();
    if (!viewModel) {
      throw new Error(
        "Expected unsafe fixture to create a work-package view model",
      );
    }
    const { details } = viewModel;
    const props = [
      ...collectElementProps(DescriptionView({ ...details.description })),
      ...collectElementProps(LinkView({ url: details.url, children: 50 })),
      ...collectElementProps(
        TitleView({
          id: details.id,
          subject: details.subject,
          url: details.url,
        }),
      ),
      ...collectElementProps(
        LayoutView({
          borderColor: details.type.color,
          children: null,
        }),
      ),
      ...collectElementProps(StatusView({ ...details.status })),
      ...collectElementProps(ActionsView({ url: details.url })),
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
    const viewModel = new CreatedMessageViewModel(data).getSnapshot();
    if (!viewModel) {
      throw new Error(
        "Expected unsafe fixture to create a work-package view model",
      );
    }
    const props = collectElementProps(
      DescriptionView({ ...viewModel.details.description }),
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
      DescriptionView({ ...viewModel.details.description }),
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
  it("renders CreatedView from a view-model snapshot", () => {
    const snapshot = new CreatedMessageViewModel({
      [WORK_PACKAGE_KEY]: WORK_PACKAGE,
    }).getSnapshot();

    const markup = renderToStaticMarkup(
      React.createElement(CreatedView, {
        vm: new MockViewModel(snapshot),
      }),
    );

    expect(markup).toContain("created by OpenProject Admin");
    expect(markup).toContain(`#${WORK_PACKAGE.id} ${WORK_PACKAGE.subject}`);
  });

  it("renders no markup for a null CreatedView snapshot", () => {
    const markup = renderToStaticMarkup(
      React.createElement(CreatedView, {
        vm: new MockViewModel(null),
      }),
    );

    expect(markup).toBe("");
  });

  it("renders UpdatedView from a view-model snapshot", () => {
    const snapshot = new UpdatedMessageViewModel({
      [WORK_PACKAGE_KEY]: WORK_PACKAGE,
      [CHANGED_WORK_PACKAGE_KEY]: { subject: "Previous subject" },
    }).getSnapshot();

    const markup = renderToStaticMarkup(
      React.createElement(UpdatedView, {
        vm: new MockViewModel(snapshot),
      }),
    );

    expect(markup).toContain("updated");
    expect(markup).toContain("Subject changed");
  });

  it("renders no markup for a null UpdatedView snapshot", () => {
    const markup = renderToStaticMarkup(
      React.createElement(UpdatedView, {
        vm: new MockViewModel(null),
      }),
    );

    expect(markup).toBe("");
  });

  it("renders a created message through the view-model boundary", () => {
    const markup = renderToStaticMarkup(
      React.createElement(OpenProjectMessageRenderer, {
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
      React.createElement(OpenProjectMessageRenderer, {
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
