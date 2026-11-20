import markdown from "markdown-it";
import type {
  OpenProjectContent,
  OpenProjectDescription,
  OpenProjectPerson,
  OpenProjectProjectContent,
  OpenProjectStatus,
  OpenProjectActivityContent,
  OpenProjectWorkPackageChanges,
  OpenProjectWorkPackageContent,
} from "../src/models/OpenProjectMatrixEventContent";

const md = new markdown();

export const author: OpenProjectPerson = {
  name: "Ada Lovelace",
  url: "https://openproject.example/users/1",
};

export const assignee: OpenProjectPerson = {
  name: "Grace Hopper",
  url: "https://openproject.example/users/2",
};

export const responsible: OpenProjectPerson = {
  name: "Alan Turing",
  url: "https://openproject.example/users/3",
};

export const project: OpenProjectProjectContent = {
  id: 1,
  name: "Northwind",
  url: "https://openproject.example/projects/northwind",
};

export const status: OpenProjectStatus = {
  name: "In progress",
  color: "#1d70b8",
};

export const changedFromStatus: OpenProjectStatus = {
  name: "New",
  color: "#6b7280",
};

export const type: OpenProjectStatus = {
  name: "Feature",
  color: "#7c3aed",
};

export const priority: OpenProjectStatus = {
  name: "High",
  color: "#dc2626",
};

export const description: OpenProjectDescription = {
  plain: "Add a compact project overview to the work package.",
  html: "<p>Add a <strong>compact project overview</strong> to the work package.</p>",
};

export const minimalWorkPackage: OpenProjectWorkPackageContent = {
  id: 57,
  subject: "Right-panel PDF viewer - decide download vs stream",
  description: { plain: "" },
  url: "https://openproject.example/work_packages/57",
  author,
  status,
  type,
};

export const describedWorkPackage: OpenProjectWorkPackageContent = {
  ...minimalWorkPackage,
  description,
};

export const completeWorkPackage: OpenProjectWorkPackageContent = {
  ...describedWorkPackage,
  assignee,
  responsible,
  priority,
  percentageDone: 65,
  dueDate: "2026-10-15",
};

export const changedWorkPackage: OpenProjectWorkPackageContent = {
  ...completeWorkPackage,
  subject: "Add the completed project overview",
  status: { name: "Closed", color: "#15803d" },
  priority: { name: "Normal", color: "#ca8a04" },
  percentageDone: 100,
  dueDate: "2026-11-01",
};

export const changedStatusDetails: OpenProjectWorkPackageChanges = {
  status: changedFromStatus,
};

export const changedDescriptionDetails: OpenProjectWorkPackageChanges = {
  description: { plain: "The previous description." },
};

export const changedAssigneeDetails: OpenProjectWorkPackageChanges = {
  assignee,
};

export const changedResponsibleDetails: OpenProjectWorkPackageChanges = {
  responsible,
};

export const changedPriorityDetails: OpenProjectWorkPackageChanges = {
  priority,
};

export const changedDueDateDetails: OpenProjectWorkPackageChanges = {
  dueDate: "2026-10-01",
};

export const changedPercentageDetails: OpenProjectWorkPackageChanges = {
  percentageDone: 40,
};

export const changedSubjectDetails: OpenProjectWorkPackageChanges = {
  subject: "The previous subject",
};

export const changedTypeDetails: OpenProjectWorkPackageChanges = {
  type,
};

export const clearedOptionalValuesWorkPackage: OpenProjectWorkPackageContent = {
  ...minimalWorkPackage,
  percentageDone: null,
  dueDate: null,
  priority: undefined,
};

export const clearedOptionalValuesDetails: OpenProjectWorkPackageChanges = {
  assignee,
  responsible,
  priority,
  percentageDone: 40,
  dueDate: "2026-10-01",
};

export const untrustedWorkPackage: OpenProjectWorkPackageContent = {
  ...minimalWorkPackage,
  url: "javascript:alert('unsafe')",
  description: {
    plain: "This remains plain text: <script>alert('unsafe')</script>",
    html: '<img src="x" onerror="alert(1)"><strong>Safe text</strong>',
  },
  type: { name: "Epic", color: "not-a-color" },
  status: { name: "Not started", color: "rgb(0, 0, 0)" },
  author: { ...author, url: "data:text/html,unsafe" },
};

export const createdContent: OpenProjectContent = {
  "org.matrix.matrix-hookshot.openproject.work_package": minimalWorkPackage,
  "org.matrix.matrix-hookshot.openproject.project": project,
};

export const describedContent: OpenProjectContent = {
  "org.matrix.matrix-hookshot.openproject.work_package": describedWorkPackage,
  "org.matrix.matrix-hookshot.openproject.project": project,
};

export const changedContent: OpenProjectContent = {
  "org.matrix.matrix-hookshot.openproject.work_package": changedWorkPackage,
  "org.matrix.matrix-hookshot.openproject.project": project,
  "org.matrix.matrix-hookshot.openproject.work_package.changed":
    changedStatusDetails,
};

const activityWorkPackage = {
  ...minimalWorkPackage,
  id: 57,
  subject: "Add project overview",
  url: "https://openproject.example/work_packages/57",
};

type ActivityActor = NonNullable<
  OpenProjectActivityContent["org.matrix.matrix-hookshot.openproject.actor"]
>;

function createActivityContent(
  changes: string[],
  actor?: ActivityActor,
): OpenProjectActivityContent {
  const firstChange = changes[0] ?? "updated the details";
  const remainingChanges = changes.length - 1;
  const remainingSummary =
    remainingChanges > 0
      ? ` and made ${remainingChanges === 1 ? "one" : remainingChanges} more ${remainingChanges === 1 ? "update to" : "updates to"}`
      : " on";
  const actorName = actor?.name ?? "Someone";
  const body = `**${actorName}** ${firstChange}${remainingSummary} [#${activityWorkPackage.id} ${activityWorkPackage.subject}](${activityWorkPackage.url})`;

  return {
    body,
    format: "org.matrix.custom.html",
    formatted_body: md.renderInline(body),
    external_url: activityWorkPackage.url,
    ...(actor ? { "org.matrix.matrix-hookshot.openproject.actor": actor } : {}),
    "org.matrix.matrix-hookshot.openproject.work_package": {
      id: activityWorkPackage.id,
      subject: activityWorkPackage.subject,
      url: activityWorkPackage.url,
    },
    "org.matrix.matrix-hookshot.openproject.schema_version": 1,
    "org.matrix.matrix-hookshot.openproject.event_kind": "activity",
    "org.matrix.matrix-hookshot.openproject.changes": changes,
  };
}

export const activityWithActor = createActivityContent(
  ["assigned **Grace Hopper**", "updated the subject"],
  {
    id: 1,
    name: "Ada Lovelace",
    url: "https://openproject.example/users/1",
  },
);

export const activityWithoutActor = createActivityContent([
  "updated the description",
]);

export const activityWithNoChanges = createActivityContent([]);

export const linkedActivity = {
  ...activityWithActor,
  "org.matrix.matrix-hookshot.openproject.anchor_event_id":
    "$original-anchor:example.org",
} satisfies OpenProjectActivityContent;
