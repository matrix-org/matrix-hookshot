import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MockViewModel } from "@element-hq/web-shared-components";
import { describe, expect, it } from "vitest";
import { ActionsView } from "../src/components/workPackage/ActionsView";
import { LinkView } from "../src/components/workPackage/LinkView";
import { TitleView } from "../src/components/workPackage/TitleView";
import { UpdateView } from "../src/components/workPackage/UpdateView";
import type { OpenProjectUpdateContent } from "../src/models/OpenProjectMatrixEventContent";
import { createDetailsSnapshot } from "../src/viewmodels/workPackage/DetailsSnapshot";
import { UpdateMessageViewModel } from "../src/viewmodels/workPackage/UpdateMessageViewModel";
import { PROJECT, WORK_PACKAGE } from "./fixtures/WorkPackageFixtures";

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

  it("allows HTTP URLs in links", () => {
    expect(
      LinkView({
        url: "http://openproject.example/work_packages/50",
        children: 50,
      }).props.href,
    ).toBe("http://openproject.example/work_packages/50");
  });

  it("rejects unsafe URLs in links", () => {
    expect(
      LinkView({ url: "javascript:alert(1)", children: 50 }).props.href,
    ).toBeUndefined();
  });

  it("rejects unsafe URLs in work-package titles", () => {
    const props = collectElementProps(
      TitleView({ id: 50, subject: "Unsafe", url: "data:text/html,unsafe" }),
    );

    expect(props.some((elementProps) => "href" in elementProps)).toBe(false);
  });

  it("rejects malformed URLs in work-package actions", () => {
    const props = collectElementProps(ActionsView({ url: "not a URL" }));

    expect(props.some((elementProps) => "href" in elementProps)).toBe(false);
  });
});

describe("OpenProject details snapshot", () => {
  it("extracts the project name and normalizes deadlines", () => {
    const details = createDetailsSnapshot({
      workPackage: {
        ...WORK_PACKAGE,
        deadline: { date: "2026-09-30", label: "Due" },
      },
      project: PROJECT,
    });

    expect(details.project).toBe(PROJECT.name);
    expect(details.deadline).toEqual({
      label: "Due",
      date: "30 Sept",
    });
  });
});

describe("OpenProject update renderer", () => {
  it("renders actor attribution and the compact change summary", () => {
    const data = {
      "org.matrix.matrix-hookshot.openproject.work_package": {
        id: WORK_PACKAGE.id,
        subject: WORK_PACKAGE.subject,
        url: WORK_PACKAGE.url,
      },
      "org.matrix.matrix-hookshot.openproject.actor": {
        id: 10,
        name: "OpenProject Admin",
        url: "https://openproject.example/users/10",
      },
      "org.matrix.matrix-hookshot.openproject.changes": [
        "assigned **Alice**",
        "updated the subject",
      ],
      "org.matrix.matrix-hookshot.openproject.schema_version": 1,
      "org.matrix.matrix-hookshot.openproject.event_kind": "update",
    } satisfies OpenProjectUpdateContent;
    const snapshot = new UpdateMessageViewModel(data).getSnapshot();

    expect(snapshot).toMatchObject({
      changeSummary: "assigned **Alice** and made 1 more update",
      actor: { name: "OpenProject Admin" },
    });

    const markup = renderToStaticMarkup(
      React.createElement(UpdateView, {
        vm: new MockViewModel(snapshot),
      }),
    );

    expect(markup).toContain("OpenProject Admin");
    expect(markup).toContain("assigned **Alice** and made 1 more update");
    expect(markup).toContain('href="https://openproject.example/users/10"');
    expect(markup).toContain(
      'href="https://openproject.example/projects/demo-project/work_packages/50"',
    );
  });
});
