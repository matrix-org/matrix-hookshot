import { describe, expect, it } from "vitest";
import {
  formatWorkPackageDiff,
  formatWorkPackageForMatrix,
} from "../../src/openproject/Format";
import { workPackageToCacheState } from "../../src/openproject/State";
import type { OpenProjectWorkPackage } from "../../src/openproject/Types";
import { BASE_URL, WORK_PACKAGE } from "./WorkPackageFixtures";

type WorkPackageChanges = {
  subject?: string;
  description?: OpenProjectWorkPackage["description"];
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
  const { subject, description, dueDate, percentageDone, ...embeddedChanges } =
    changes;
  return {
    ...WORK_PACKAGE,
    ...(subject === undefined ? {} : { subject }),
    ...(description === undefined ? {} : { description }),
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
        status: {
          name: "New",
          color: "#D9D9D9",
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
