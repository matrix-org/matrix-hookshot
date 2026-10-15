// @vitest-environment happy-dom

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActionsView } from "../src/components/workPackage/ActionsView";
import { LinkView } from "../src/components/workPackage/LinkView";
import { ActivityView } from "../src/components/workPackage/ActivityView";
import type { OpenProjectActivityContent } from "../src/models/OpenProjectMatrixEventContent";
import { createDetailsSnapshot } from "../src/viewmodels/workPackage/DetailsSnapshot";
import { ActivityMessageViewModel } from "../src/viewmodels/workPackage/ActivityMessageViewModel";
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

describe("OpenProject Activity renderer", () => {
  it("renders the original timeline card and navigates to it in the event room", () => {
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
        "assigned <strong>Alice</strong>",
        "updated the subject",
      ],
      "org.matrix.matrix-hookshot.openproject.schema_version": 1,
      "org.matrix.matrix-hookshot.openproject.event_kind": "activity",
      "org.matrix.matrix-hookshot.openproject.anchor_event_id":
        "$original-anchor:example.org",
      room_id: "!forged-room:example.org",
      permalink: "https://attacker.example/",
    } satisfies OpenProjectActivityContent & {
      room_id: string;
      permalink: string;
    };
    const onViewTimelineCard = vi.fn();
    const vm = new ActivityMessageViewModel({
      data,
      roomId: "!activity-room:example.org",
      onViewTimelineCard,
    });
    const snapshot = vm.getSnapshot();

    expect(snapshot).toMatchObject({
      changeSummary: "assigned <strong>Alice</strong> and made 1 more update.",
      actor: { name: "OpenProject Admin" },
    });

    const markup = renderToStaticMarkup(
      React.createElement(ActivityView, {
        vm,
      }),
    );

    expect(markup).toContain("OpenProject Admin");
    expect(markup).toContain(
      "assigned <strong>Alice</strong> and made 1 more update.",
    );
    expect(markup).toContain('href="https://openproject.example/users/10"');
    expect(markup).toContain(
      'href="https://openproject.example/projects/demo-project/work_packages/50"',
    );
    expect(markup).toContain("View timeline card");

    render(
      React.createElement(ActivityView, {
        vm,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "View timeline card" }));
    expect(onViewTimelineCard).toHaveBeenCalledWith(
      "https://matrix.to/#/!activity-room%3Aexample.org/%24original-anchor%3Aexample.org",
    );
  });

  it.each([
    ["missing event ID", undefined, "!room:example.org"],
    ["malformed event ID", "https://attacker.example/", "!room:example.org"],
    ["malformed room ID", "$original-anchor:example.org", "not a room"],
  ])("hides only the card action for %s", (_name, eventId, roomId) => {
    const data = {
      "org.matrix.matrix-hookshot.openproject.work_package": {
        id: WORK_PACKAGE.id,
        subject: WORK_PACKAGE.subject,
        url: WORK_PACKAGE.url,
      },
      "org.matrix.matrix-hookshot.openproject.changes": ["updated the subject"],
      "org.matrix.matrix-hookshot.openproject.schema_version": 1,
      "org.matrix.matrix-hookshot.openproject.event_kind": "activity",
      ...(eventId === undefined
        ? {}
        : {
            "org.matrix.matrix-hookshot.openproject.anchor_event_id": eventId,
          }),
    } satisfies OpenProjectActivityContent;
    const vm = new ActivityMessageViewModel({
      data,
      roomId,
      onViewTimelineCard: vi.fn(),
    });
    const markup = renderToStaticMarkup(
      React.createElement(ActivityView, {
        vm,
      }),
    );

    expect(markup).toContain(WORK_PACKAGE.subject);
    expect(markup).not.toContain("View timeline card");
  });
});
