import { describe, expect, it } from "vitest";
import {
  formatWorkPackageAnchorContent,
  formatWorkPackageAnchorForMatrix,
  formatWorkPackageAnchorReplacement,
  formatInactiveWorkPackageAnchorReplacement,
  formatWorkPackageDiff,
  formatWorkPackageForMatrix,
  formatWorkPackageFallback,
  formatWorkPackageActivityForMatrix,
} from "../../src/openproject/Format";
import { workPackageToCacheState } from "../../src/openproject/State";
import type { OpenProjectWorkPackage } from "../../src/openproject/Types";
import {
  OPENPROJECT_ANCHOR_EVENT_KIND,
  OPENPROJECT_ANCHOR_STATE_ACTIVE,
  OPENPROJECT_ANCHOR_STATE_INACTIVE,
  OPENPROJECT_EVENT_SCHEMA_VERSION,
  OPENPROJECT_ACTIVITY_EVENT_KIND,
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

const SNAPSHOT_ID = "00000000-0000-4000-8000-000000000001";
const NEXT_SNAPSHOT_ID = "00000000-0000-4000-8000-000000000002";

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
        priority: {
          name: "Normal",
          color: "#74C0FC",
        },
        percentageDone: null,
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
    expect(
      formatWorkPackageAnchorForMatrix(WORK_PACKAGE, BASE_URL, {
        snapshotId: SNAPSHOT_ID,
      }),
    ).toEqual({
      ...formatWorkPackageForMatrix(WORK_PACKAGE, BASE_URL),
      "org.matrix.matrix-hookshot.openproject.schema_version":
        OPENPROJECT_EVENT_SCHEMA_VERSION,
      "org.matrix.matrix-hookshot.openproject.event_kind":
        OPENPROJECT_ANCHOR_EVENT_KIND,
      "org.matrix.matrix-hookshot.openproject.anchor_state":
        OPENPROJECT_ANCHOR_STATE_ACTIVE,
      "org.matrix.matrix-hookshot.openproject.snapshot_id": SNAPSHOT_ID,
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

  it("normalizes omitted dates and a null assignee in an anchor snapshot", () => {
    const workPackage = {
      ...WORK_PACKAGE,
      date: undefined,
      dueDate: undefined,
      _embedded: {
        ...WORK_PACKAGE._embedded,
        assignee: null,
      },
    } as unknown as OpenProjectWorkPackage;

    const snapshot = formatWorkPackageForMatrix(workPackage, BASE_URL)[
      "org.matrix.matrix-hookshot.openproject.work_package"
    ];

    expect(snapshot.assignee).toBeUndefined();
    expect(snapshot.date).toBeNull();
    expect(snapshot.dueDate).toBeNull();
    expect(snapshot.deadline).toBeNull();
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

  it("includes responsibility, priority, and completion in the anchor snapshot", () => {
    const workPackage = workPackageWithChanges({
      percentageDone: 55,
      priority: { ...WORK_PACKAGE._embedded.priority, id: 9, name: "High" },
      responsible: RESPONSIBLE,
    });

    expect(
      formatWorkPackageForMatrix(workPackage, BASE_URL)[
        "org.matrix.matrix-hookshot.openproject.work_package"
      ],
    ).toMatchObject({
      responsible: {
        name: "Bob",
        url: "https://openproject.example/users/12",
      },
      priority: {
        name: "High",
        color: WORK_PACKAGE._embedded.priority.color,
      },
      percentageDone: 55,
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
  it("renders a one-line active fallback with the work package identity", () => {
    const workPackage = workPackageWithChanges({
      date: null,
      dueDate: "2026-09-30",
    });

    expect(formatWorkPackageFallback(workPackage, BASE_URL)).toBe(
      'Work package [50](https://openproject.example/projects/demo-project/work_packages/50): "Build the bridge" — added to the timeline',
    );
  });

  it("renders a one-line inactive fallback", () => {
    const workPackage = workPackageWithChanges({
      assignee: undefined,
      date: "2026-09-30",
    });

    const fallback = formatWorkPackageFallback(
      workPackage,
      BASE_URL,
      OPENPROJECT_ANCHOR_STATE_INACTIVE,
    );
    expect(fallback).toBe(
      'Work package [50](https://openproject.example/projects/demo-project/work_packages/50): "Build the bridge" — removed from the timeline',
    );
  });
});

describe("OpenProject versioned message content", () => {
  it("builds complete active anchor content", () => {
    const content = formatWorkPackageAnchorContent(WORK_PACKAGE, BASE_URL, {
      snapshotId: SNAPSHOT_ID,
    });

    expect(content).toMatchObject({
      msgtype: "m.notice",
      body: expect.stringContaining("added to the timeline"),
      "org.matrix.matrix-hookshot.openproject.schema_version":
        OPENPROJECT_EVENT_SCHEMA_VERSION,
      "org.matrix.matrix-hookshot.openproject.event_kind":
        OPENPROJECT_ANCHOR_EVENT_KIND,
      "org.matrix.matrix-hookshot.openproject.anchor_state":
        OPENPROJECT_ANCHOR_STATE_ACTIVE,
      "org.matrix.matrix-hookshot.openproject.snapshot_id": SNAPSHOT_ID,
    });
    expect(
      content["org.matrix.matrix-hookshot.openproject.work_package"],
    ).toMatchObject({
      date: null,
      dueDate: null,
      deadline: null,
      status: { isClosed: false },
    });
    // Keep the original snapshot fields available to existing consumers as
    // the versioned event contract grows additively.
    expect(content).toMatchObject({
      "org.matrix.matrix-hookshot.openproject.work_package": {
        id: WORK_PACKAGE.id,
        subject: WORK_PACKAGE.subject,
        description: {
          plain: WORK_PACKAGE.description.raw,
          html: WORK_PACKAGE.description.html,
        },
        author: { name: WORK_PACKAGE._embedded.author.name },
        type: { name: WORK_PACKAGE._embedded.type.name },
      },
      "org.matrix.matrix-hookshot.openproject.project": {
        id: WORK_PACKAGE._embedded.project.id,
        name: WORK_PACKAGE._embedded.project.name,
      },
      external_url:
        "https://openproject.example/projects/demo-project/work_packages/50",
    });
  });

  it("builds a visibly inactive anchor content", () => {
    const content = formatWorkPackageAnchorContent(WORK_PACKAGE, BASE_URL, {
      snapshotId: SNAPSHOT_ID,
      anchorState: OPENPROJECT_ANCHOR_STATE_INACTIVE,
    });

    expect(content["org.matrix.matrix-hookshot.openproject.anchor_state"]).toBe(
      OPENPROJECT_ANCHOR_STATE_INACTIVE,
    );
    expect(content.body).toContain("removed from the timeline");
  });

  it("builds a complete active anchor replacement", () => {
    const content = formatWorkPackageAnchorReplacement(
      "$original-anchor",
      WORK_PACKAGE,
      BASE_URL,
      { snapshotId: SNAPSHOT_ID },
    );
    const newContent = formatWorkPackageAnchorContent(WORK_PACKAGE, BASE_URL, {
      snapshotId: SNAPSHOT_ID,
    });

    expect(content).toEqual({
      msgtype: "m.notice",
      body: newContent.body,
      "m.new_content": newContent,
      "m.relates_to": {
        rel_type: "m.replace",
        event_id: "$original-anchor",
      },
    });
  });

  it("keeps inactive replacement content complete and marked inactive", () => {
    const inactiveContent = formatWorkPackageAnchorContent(
      WORK_PACKAGE,
      BASE_URL,
      {
        snapshotId: NEXT_SNAPSHOT_ID,
        anchorState: OPENPROJECT_ANCHOR_STATE_INACTIVE,
      },
    );
    const content = formatWorkPackageAnchorReplacement(
      "$original-anchor",
      WORK_PACKAGE,
      BASE_URL,
      {
        snapshotId: NEXT_SNAPSHOT_ID,
        anchorState: OPENPROJECT_ANCHOR_STATE_INACTIVE,
      },
    );

    expect(content).toMatchObject({
      msgtype: "m.notice",
      body: inactiveContent.body,
      "m.relates_to": {
        rel_type: "m.replace",
        event_id: "$original-anchor",
      },
    });
    // Replacement content is a full event snapshot, not a partial patch.
    expect(content["m.new_content"]).toEqual(inactiveContent);
    expect(
      content["m.new_content"][
        "org.matrix.matrix-hookshot.openproject.snapshot_id"
      ],
    ).toBe(NEXT_SNAPSHOT_ID);
    expect(
      content["m.new_content"][
        "org.matrix.matrix-hookshot.openproject.snapshot_id"
      ],
    ).not.toBe("$original-anchor");
    expect(content["m.new_content"].body).toContain(
      "removed from the timeline",
    );
  });

  it("builds an inactive replacement from the last committed active snapshot", () => {
    const activeWorkPackage = workPackageWithChanges({
      status: { ...WORK_PACKAGE._embedded.status, name: "In progress" },
    });
    const lastActiveContent = formatWorkPackageAnchorContent(
      activeWorkPackage,
      BASE_URL,
      { snapshotId: SNAPSHOT_ID },
    );
    const content = formatInactiveWorkPackageAnchorReplacement(
      "$original-anchor",
      lastActiveContent,
      NEXT_SNAPSHOT_ID,
    );
    const inactiveContent = content["m.new_content"];

    expect(content).toMatchObject({
      msgtype: "m.notice",
      body: `Work package [50](https://openproject.example/projects/demo-project/work_packages/50): "Build the bridge" — removed from the timeline`,
      "m.relates_to": {
        rel_type: "m.replace",
        event_id: "$original-anchor",
      },
    });
    expect(inactiveContent).toMatchObject({
      msgtype: "m.notice",
      body: 'Work package [50](https://openproject.example/projects/demo-project/work_packages/50): "Build the bridge" — removed from the timeline',
      "org.matrix.matrix-hookshot.openproject.anchor_state":
        OPENPROJECT_ANCHOR_STATE_INACTIVE,
      "org.matrix.matrix-hookshot.openproject.snapshot_id": NEXT_SNAPSHOT_ID,
      "org.matrix.matrix-hookshot.openproject.work_package": {
        id: 50,
        subject: "Build the bridge",
        status: { name: "In progress", isClosed: false },
      },
      external_url:
        "https://openproject.example/projects/demo-project/work_packages/50",
    });
    expect(
      inactiveContent["org.matrix.matrix-hookshot.openproject.snapshot_id"],
    ).not.toBe(SNAPSHOT_ID);
    expect(
      inactiveContent["org.matrix.matrix-hookshot.openproject.work_package"]
        .url,
    ).toBe(
      lastActiveContent["org.matrix.matrix-hookshot.openproject.work_package"]
        .url,
    );
  });

  it("builds a display-only update with actor attribution", () => {
    const content = formatWorkPackageActivityForMatrix(
      WORK_PACKAGE,
      BASE_URL,
      ["updated the subject"],
      {
        actor: { id: 12, name: "Webhook User" },
        anchorEventId: "$original-anchor",
      },
    );

    expect(content).toEqual({
      msgtype: "m.notice",
      body: `**Webhook User** updated the subject on [#50 Build the bridge](https://openproject.example/projects/demo-project/work_packages/50)`,
      format: "org.matrix.custom.html",
      formatted_body:
        '<strong>Webhook User</strong> updated the subject on <a href="https://openproject.example/projects/demo-project/work_packages/50">#50 Build the bridge</a>',
      "org.matrix.matrix-hookshot.openproject.work_package": {
        id: 50,
        subject: "Build the bridge",
        url: "https://openproject.example/projects/demo-project/work_packages/50",
      },
      "org.matrix.matrix-hookshot.openproject.project": {
        id: 1,
        name: "Demo project",
        url: "https://openproject.example/projects/1",
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
        OPENPROJECT_ACTIVITY_EVENT_KIND,
      external_url:
        "https://openproject.example/projects/demo-project/work_packages/50",
      "org.matrix.matrix-hookshot.openproject.anchor_event_id":
        "$original-anchor",
    });
    expect(content).not.toHaveProperty(
      "org.matrix.matrix-hookshot.openproject.anchor_state",
    );
    expect(content).not.toHaveProperty("m.relates_to");
    expect(content).not.toHaveProperty("m.new_content");
  });

  it("escapes Markdown link text without changing the work-package URL", () => {
    const subject = String.raw`Build ](https://attacker.example) [phase] \ path`;
    const content = formatWorkPackageActivityForMatrix(
      workPackageWithChanges({ subject }),
      BASE_URL,
      ["updated the subject"],
    );
    const workPackageUrl =
      "https://openproject.example/projects/demo-project/work_packages/50";

    const expectedEscapedLabel = String.raw`#50 Build \](https://attacker.example) \[phase\] \\ path`;
    expect(content.body).toContain(
      `[${expectedEscapedLabel}](${workPackageUrl})`,
    );
    expect(content.formatted_body).toContain(
      String.raw`<a href="${workPackageUrl}">#50 Build ](https://attacker.example) [phase] \ path</a>`,
    );
    expect(content.external_url).toBe(workPackageUrl);
  });

  it("uses neutral attribution when the webhook has no actor", () => {
    const content = formatWorkPackageActivityForMatrix(WORK_PACKAGE, BASE_URL, [
      "updated the subject",
    ]);

    expect(content.body).toMatch(
      /^\*\*Someone\*\* updated the subject on \[#50 Build the bridge\]/,
    );
    expect(content).not.toHaveProperty(
      "org.matrix.matrix-hookshot.openproject.actor",
    );
    expect(content.msgtype).toBe("m.notice");
    expect(content).not.toHaveProperty(
      "org.matrix.matrix-hookshot.openproject.anchor_state",
    );
    expect(content).not.toHaveProperty("m.relates_to");
    expect(content).not.toHaveProperty("m.new_content");
    expect(content).not.toHaveProperty("command");
  });

  it("summarizes additional changes in the fallback", () => {
    const content = formatWorkPackageActivityForMatrix(
      WORK_PACKAGE,
      BASE_URL,
      ["assigned **Alice**", "updated the description", "changed the status"],
      { actor: { id: 12, name: "Webhook User" } },
    );

    expect(content.body).toContain(
      "**Webhook User** assigned **Alice** and made 2 more updates to [#50 Build the bridge]",
    );
    expect(content.body).not.toContain("<strong>");
    expect(content["org.matrix.matrix-hookshot.openproject.changes"][0]).toBe(
      "assigned **Alice**",
    );
  });

  it("uses the singular form for one additional change", () => {
    const content = formatWorkPackageActivityForMatrix(
      WORK_PACKAGE,
      BASE_URL,
      ["assigned **Alice**", "updated the description"],
      { actor: { id: 12, name: "Webhook User" } },
    );

    expect(content.body).toContain(
      "**Webhook User** assigned **Alice** and made one more update to [#50 Build the bridge]",
    );
  });

  it("formats a neutral creation fallback without the original author", () => {
    const content = formatWorkPackageActivityForMatrix(
      WORK_PACKAGE,
      BASE_URL,
      ["created the work package"],
      { created: true },
    );

    expect(content.body).toBe(
      "**Someone** created [#50 Build the bridge](https://openproject.example/projects/demo-project/work_packages/50)",
    );
    expect(content["org.matrix.matrix-hookshot.openproject.changes"]).toEqual([
      "created the work package",
    ]);
    expect(content).not.toHaveProperty(
      "org.matrix.matrix-hookshot.openproject.actor",
    );
    expect(content).not.toHaveProperty(
      "org.matrix.matrix-hookshot.openproject.anchor_event_id",
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
      categories: ["work_package:assignee_changed"],
    },
    {
      name: "an assignee being removed",
      current: workPackageWithChanges({ assignee: undefined }),
      changes: ["removed assignee"],
      categories: ["work_package:assignee_changed"],
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
      categories: ["work_package:description_changed"],
    },
    {
      name: "a due date being set",
      current: workPackageWithChanges({ dueDate: "2025-06-01" }),
      changes: ["set the due date to **2025-06-01**"],
      categories: ["work_package:duedate_changed"],
    },
    {
      name: "a due date being removed",
      previous: workPackageWithChanges({ dueDate: "2025-06-01" }),
      current: WORK_PACKAGE,
      changes: ["removed the due date"],
      categories: ["work_package:duedate_changed"],
    },
    {
      name: "the percentage complete changing",
      current: workPackageWithChanges({ percentageDone: 50 }),
      changes: ["set the work completed percentage to **50%**"],
      categories: ["work_package:workpercent_changed"],
    },
    {
      name: "the priority changing",
      current: workPackageWithChanges({
        priority: { ...WORK_PACKAGE._embedded.priority, id: 9, name: "High" },
      }),
      changes: ["changed the priority from **Normal** to **High**"],
      categories: ["work_package:priority_changed"],
    },
    {
      name: "a responsible user being added",
      current: workPackageWithChanges({ responsible: RESPONSIBLE }),
      changes: ["set Bob as responsible"],
      categories: ["work_package:responsible_changed"],
    },
    {
      name: "a responsible user being removed",
      previous: workPackageWithChanges({ responsible: RESPONSIBLE }),
      current: WORK_PACKAGE,
      changes: ["removed responsible user"],
      categories: ["work_package:responsible_changed"],
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
      categories: ["work_package:updated"],
    },
    {
      name: "the subject changing",
      current: workPackageWithChanges({ subject: "Build the better bridge" }),
      changes: ["updated the subject"],
      categories: ["work_package:subject_changed"],
    },
    {
      name: "the type changing",
      current: workPackageWithChanges({
        type: { ...WORK_PACKAGE._embedded.type, id: 3, name: "Task" },
      }),
      changes: ["changed the type to **Task**"],
      categories: ["work_package:updated"],
    },
    {
      name: "a milestone date being set",
      current: workPackageWithChanges({ date: "2025-06-01" }),
      changes: ["set the date to **2025-06-01**"],
      categories: ["work_package:duedate_changed"],
    },
    {
      name: "a milestone date being removed",
      previous: workPackageWithChanges({ date: "2025-06-01" }),
      current: WORK_PACKAGE,
      changes: ["removed the date"],
      categories: ["work_package:duedate_changed"],
    },
    {
      name: "completion reaching zero",
      previous: workPackageWithChanges({ percentageDone: 20 }),
      current: workPackageWithChanges({ percentageDone: 0 }),
      changes: ["set the work completed percentage to **0%**"],
      categories: ["work_package:workpercent_changed"],
    },
    {
      name: "completion being cleared",
      previous: workPackageWithChanges({ percentageDone: 20 }),
      current: WORK_PACKAGE,
      changes: ["cleared the work completed percentage"],
      categories: ["work_package:workpercent_changed"],
    },
    {
      name: "a cleared description",
      previous: workPackageWithChanges({
        description: { ...WORK_PACKAGE.description, raw: "Previous text" },
      }),
      current: workPackageWithChanges({
        description: { ...WORK_PACKAGE.description, raw: "" },
      }),
      changes: ["removed the description"],
      categories: ["work_package:description_changed"],
    },
    {
      name: "a mixed update containing every category",
      previous: workPackageWithChanges({
        assignee: undefined,
        description: { ...WORK_PACKAGE.description, raw: "Old text" },
        date: "2025-05-01",
        percentageDone: 20,
        status: { ...WORK_PACKAGE._embedded.status, id: 2, name: "Old status" },
        type: { ...WORK_PACKAGE._embedded.type, id: 2, name: "Old type" },
      }),
      current: workPackageWithChanges({
        description: { ...WORK_PACKAGE.description, raw: "" },
        date: "2025-06-01",
        percentageDone: 0,
        status: { ...WORK_PACKAGE._embedded.status, id: 3, name: "New status" },
        type: { ...WORK_PACKAGE._embedded.type, id: 4, name: "Task" },
      }),
      changes: [
        "assigned **Alice**",
        "removed the description",
        "set the date to **2025-06-01**",
        "set the work completed percentage to **0%**",
        "changed the status from **Old status** to **New status**",
        "changed the type to **Task**",
      ],
      categories: [
        "work_package:assignee_changed",
        "work_package:description_changed",
        "work_package:duedate_changed",
        "work_package:workpercent_changed",
        "work_package:updated",
      ],
    },
  ])("formats $name", ({ previous, current, changes, categories }) => {
    expect(diffFor(current, previous)).toEqual({
      categories,
      changes,
    });
  });

  it("returns no diff for an unchanged work package", () => {
    expect(diffFor(WORK_PACKAGE)).toBeNull();
  });
});
