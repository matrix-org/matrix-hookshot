import { describe, expect, it } from "vitest";
import {
  formatWorkPackageAnchorContent,
  formatWorkPackageAnchorForMatrix,
  formatWorkPackageDiff,
  formatWorkPackageForMatrix,
  formatWorkPackageFallback,
  formatWorkPackageUpdateForMatrix,
} from "../../src/openproject/Format";
import { workPackageToCacheState } from "../../src/openproject/State";
import type { OpenProjectWorkPackage } from "../../src/openproject/Types";
import {
  OPENPROJECT_ANCHOR_EVENT_KIND,
  OPENPROJECT_ANCHOR_STATE_ACTIVE,
  OPENPROJECT_ANCHOR_STATE_INACTIVE,
  OPENPROJECT_EVENT_SCHEMA_VERSION,
  OPENPROJECT_UPDATE_EVENT_KIND,
} from "../../src/openproject/Schema";
import { BASE_URL, WORK_PACKAGE } from "./WorkPackageFixtures";

type WorkPackageChanges = {
  subject?: string;
  description?: OpenProjectWorkPackage["description"];
  date?: string | null;
  dueDate?: string | null;
  percentageDone?: number | null;
  assignee?: OpenProjectWorkPackage["_embedded"]["assignee"];
  responsible?: OpenProjectWorkPackage["_embedded"]["responsible"];
  priority?: OpenProjectWorkPackage["_embedded"]["priority"];
  status?: OpenProjectWorkPackage["_embedded"]["status"];
  type?: OpenProjectWorkPackage["_embedded"]["type"];
};

function workPackageWithChanges(
  changes: WorkPackageChanges,
): OpenProjectWorkPackage {
  const {
    subject,
    description,
    date,
    dueDate,
    percentageDone,
    ...embeddedChanges
  } = changes;
  return {
    ...WORK_PACKAGE,
    ...(subject === undefined ? {} : { subject }),
    ...(description === undefined ? {} : { description }),
    ...(date === undefined ? {} : { date }),
    ...(dueDate === undefined ? {} : { dueDate }),
    ...(percentageDone === undefined ? {} : { percentageDone }),
    _embedded: {
      ...WORK_PACKAGE._embedded,
      ...embeddedChanges,
    },
  };
}

function diffFor(
  current: OpenProjectWorkPackage,
  previous: OpenProjectWorkPackage = WORK_PACKAGE,
) {
  return formatWorkPackageDiff(workPackageToCacheState(previous), current);
}

const RESPONSIBLE = {
  id: 12,
  name: "Bob",
} as NonNullable<OpenProjectWorkPackage["_embedded"]["responsible"]>;

describe("OpenProject Matrix formatter", () => {
  it("preserves the existing base work-package payload", () => {
    expect(formatWorkPackageForMatrix(WORK_PACKAGE, BASE_URL)).toEqual({
      "org.matrix.matrix-hookshot.openproject.work_package": {
        id: 50,
        subject: "Build the bridge",
        description: {
          plain: "A short description",
          html: "<p>A short description</p>",
        },
        url: "https://openproject.example/projects/demo-project/work_packages/50",
        author: {
          name: "OpenProject Admin",
          url: "https://openproject.example/users/10",
        },
        assignee: {
          name: "Alice",
          url: "https://openproject.example/users/11",
        },
        dueDate: null,
        date: null,
        deadline: null,
        status: {
          name: "New",
          color: "#D9D9D9",
          isClosed: false,
        },
        type: {
          name: "Milestone",
          color: "#35C53F",
        },
      },
      "org.matrix.matrix-hookshot.openproject.project": {
        id: 1,
        name: "Demo project",
        url: "https://openproject.example/projects/1",
      },
      external_url:
        "https://openproject.example/projects/demo-project/work_packages/50",
    });
  });

  it("marks an initial full work-package event as a versioned anchor", () => {
    expect(formatWorkPackageAnchorForMatrix(WORK_PACKAGE, BASE_URL)).toEqual({
      ...formatWorkPackageForMatrix(WORK_PACKAGE, BASE_URL),
      "org.matrix.matrix-hookshot.openproject.schema_version":
        OPENPROJECT_EVENT_SCHEMA_VERSION,
      "org.matrix.matrix-hookshot.openproject.event_kind":
        OPENPROJECT_ANCHOR_EVENT_KIND,
      "org.matrix.matrix-hookshot.openproject.anchor_state":
        OPENPROJECT_ANCHOR_STATE_ACTIVE,
    });
  });

  it("normalizes an ordinary due date", () => {
    const workPackage = workPackageWithChanges({
      date: null,
      dueDate: "2026-09-30",
    });

    expect(
      formatWorkPackageForMatrix(workPackage, BASE_URL)[
        "org.matrix.matrix-hookshot.openproject.work_package"
      ],
    ).toMatchObject({
      dueDate: "2026-09-30",
      date: null,
      deadline: { date: "2026-09-30", label: "Due" },
    });
  });

  it("normalizes a milestone date", () => {
    const workPackage = workPackageWithChanges({
      date: "2026-09-30",
      dueDate: null,
    });

    expect(
      formatWorkPackageForMatrix(workPackage, BASE_URL)[
        "org.matrix.matrix-hookshot.openproject.work_package"
      ],
    ).toMatchObject({
      dueDate: null,
      date: "2026-09-30",
      deadline: { date: "2026-09-30", label: "Date" },
    });
  });

  it("includes the closed state in the snapshot", () => {
    const workPackage = workPackageWithChanges({
      status: { ...WORK_PACKAGE._embedded.status, isClosed: true },
    });

    expect(
      formatWorkPackageForMatrix(workPackage, BASE_URL)[
        "org.matrix.matrix-hookshot.openproject.work_package"
      ].status.isClosed,
    ).toBe(true);
  });
});

describe("OpenProject fallback formatter", () => {
  it("renders a complete assigned snapshot with a formatted due date", () => {
    const workPackage = workPackageWithChanges({
      date: null,
      dueDate: "2026-09-30",
    });

    expect(formatWorkPackageFallback(workPackage, BASE_URL)).toBe(
      [
        "Build the bridge",
        "Assignee: Alice",
        "Due: 30 September 2026",
        "Status: New",
        "https://openproject.example/projects/demo-project/work_packages/50",
      ].join("\n"),
    );
  });

  it("renders unassigned milestones and inactive state", () => {
    const workPackage = workPackageWithChanges({
      assignee: undefined,
      date: "2026-09-30",
    });

    const fallback = formatWorkPackageFallback(
      workPackage,
      BASE_URL,
      OPENPROJECT_ANCHOR_STATE_INACTIVE,
    );
    expect(fallback).toContain("Assignee: Unassigned");
    expect(fallback).toContain("Date: 30 September 2026");
    expect(fallback).toContain("Timeline tracking: Removed");
  });

  it("renders an explicit no-date fallback", () => {
    expect(formatWorkPackageFallback(WORK_PACKAGE, BASE_URL)).toContain(
      "No due date",
    );
  });
});

describe("OpenProject versioned message content", () => {
  it("builds complete active anchor content", () => {
    const content = formatWorkPackageAnchorContent(WORK_PACKAGE, BASE_URL);

    expect(content).toMatchObject({
      msgtype: "m.notice",
      body: expect.stringContaining("No due date"),
      "org.matrix.matrix-hookshot.openproject.schema_version":
        OPENPROJECT_EVENT_SCHEMA_VERSION,
      "org.matrix.matrix-hookshot.openproject.event_kind":
        OPENPROJECT_ANCHOR_EVENT_KIND,
      "org.matrix.matrix-hookshot.openproject.anchor_state":
        OPENPROJECT_ANCHOR_STATE_ACTIVE,
    });
    expect(
      content["org.matrix.matrix-hookshot.openproject.work_package"],
    ).toMatchObject({
      date: null,
      dueDate: null,
      deadline: null,
      status: { isClosed: false },
    });
  });

  it("builds a visibly inactive anchor content", () => {
    const content = formatWorkPackageAnchorContent(
      WORK_PACKAGE,
      BASE_URL,
      OPENPROJECT_ANCHOR_STATE_INACTIVE,
    );

    expect(content["org.matrix.matrix-hookshot.openproject.anchor_state"]).toBe(
      OPENPROJECT_ANCHOR_STATE_INACTIVE,
    );
    expect(content.body).toContain("Timeline tracking: Removed");
  });

  it("builds a display-only update with actor attribution", () => {
    const content = formatWorkPackageUpdateForMatrix(
      WORK_PACKAGE,
      BASE_URL,
      ["updated the subject"],
      { id: 12, name: "Webhook User" },
    );

    expect(content).toEqual({
      msgtype: "m.notice",
      body: `Webhook User updated the subject on work package #50: "Build the bridge"\nhttps://openproject.example/projects/demo-project/work_packages/50`,
      "org.matrix.matrix-hookshot.openproject.work_package": {
        id: 50,
        subject: "Build the bridge",
        url: "https://openproject.example/projects/demo-project/work_packages/50",
      },
      "org.matrix.matrix-hookshot.openproject.actor": {
        id: 12,
        name: "Webhook User",
        url: "https://openproject.example/users/12",
      },
      "org.matrix.matrix-hookshot.openproject.changes": ["updated the subject"],
      "org.matrix.matrix-hookshot.openproject.schema_version":
        OPENPROJECT_EVENT_SCHEMA_VERSION,
      "org.matrix.matrix-hookshot.openproject.event_kind":
        OPENPROJECT_UPDATE_EVENT_KIND,
    });
  });

  it("uses neutral attribution when the webhook has no actor", () => {
    const content = formatWorkPackageUpdateForMatrix(WORK_PACKAGE, BASE_URL, [
      "updated the subject",
    ]);

    expect(content.body).toMatch(/^Work package #50: updated the subject/);
    expect(content).not.toHaveProperty(
      "org.matrix.matrix-hookshot.openproject.actor",
    );
  });

  it("summarizes additional changes in the fallback", () => {
    const content = formatWorkPackageUpdateForMatrix(
      WORK_PACKAGE,
      BASE_URL,
      ["assigned **Alice**", "updated the description", "changed the status"],
      { id: 12, name: "Webhook User" },
    );

    expect(content.body).toContain(
      "Webhook User assigned **Alice** and made 2 more updates on work package #50",
    );
  });

  it("uses the singular form for one additional change", () => {
    const content = formatWorkPackageUpdateForMatrix(
      WORK_PACKAGE,
      BASE_URL,
      ["assigned **Alice**", "updated the description"],
      { id: 12, name: "Webhook User" },
    );

    expect(content.body).toContain(
      "Webhook User assigned **Alice** and made 1 more update on work package #50",
    );
  });
});

describe("OpenProject work-package diff formatter", () => {
  it.each([
    {
      name: "an assignee being added",
      previous: workPackageWithChanges({ assignee: undefined }),
      current: WORK_PACKAGE,
      changes: ["assigned **Alice**"],
      eventKind: "work_package:assignee_changed",
    },
    {
      name: "an assignee being removed",
      current: workPackageWithChanges({ assignee: undefined }),
      changes: ["removed assignee"],
      eventKind: "work_package:assignee_changed",
    },
    {
      name: "the description changing",
      current: workPackageWithChanges({
        description: {
          ...WORK_PACKAGE.description,
          raw: "The updated description",
          html: "<p>The updated description</p>",
        },
      }),
      changes: ["updated the description"],
      postfix: "The updated description",
      eventKind: "work_package:description_changed",
    },
    {
      name: "a due date being set",
      current: workPackageWithChanges({ dueDate: "2025-06-01" }),
      changes: ["set the due date to `2025-06-01`"],
      eventKind: "work_package:duedate_changed",
    },
    {
      name: "a due date being removed",
      previous: workPackageWithChanges({ dueDate: "2025-06-01" }),
      current: WORK_PACKAGE,
      changes: ["removed the due date"],
      eventKind: "work_package:duedate_changed",
    },
    {
      name: "the percentage complete changing",
      current: workPackageWithChanges({ percentageDone: 50 }),
      changes: ["set the work completed percentage to **50%**"],
      eventKind: "work_package:workpercent_changed",
    },
    {
      name: "the priority changing",
      current: workPackageWithChanges({
        priority: { ...WORK_PACKAGE._embedded.priority, id: 9, name: "High" },
      }),
      changes: ["changed the priority from **Normal** to **High**"],
      eventKind: "work_package:priority_changed",
    },
    {
      name: "a responsible user being added",
      current: workPackageWithChanges({ responsible: RESPONSIBLE }),
      changes: ["set Bob as responsible"],
      eventKind: "work_package:responsible_changed",
    },
    {
      name: "a responsible user being removed",
      previous: workPackageWithChanges({ responsible: RESPONSIBLE }),
      current: WORK_PACKAGE,
      changes: ["removed responsible user"],
      eventKind: "work_package:responsible_changed",
    },
    {
      name: "the status changing",
      current: workPackageWithChanges({
        status: {
          ...WORK_PACKAGE._embedded.status,
          id: 2,
          name: "In progress",
        },
      }),
      changes: ["changed the status from **New** to **In progress**"],
      eventKind: "work_package:updated",
    },
    {
      name: "the subject changing",
      current: workPackageWithChanges({ subject: "Build the better bridge" }),
      changes: ["updated the subject"],
      eventKind: "work_package:subject_changed",
    },
    {
      name: "the type changing",
      current: workPackageWithChanges({
        type: { ...WORK_PACKAGE._embedded.type, id: 3, name: "Task" },
      }),
      changes: ["changed the type to **3**"],
      eventKind: "work_package:updated",
    },
  ])("formats $name", ({ previous, current, changes, postfix, eventKind }) => {
    expect(diffFor(current, previous)).toEqual({
      changes,
      postfix,
      eventKind,
    });
  });

  it("returns no diff for an unchanged work package", () => {
    expect(diffFor(WORK_PACKAGE)).toBeNull();
  });
});
