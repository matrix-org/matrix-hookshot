import type {
  OpenProjectContent,
  OpenProjectDescription,
  OpenProjectPerson,
  OpenProjectStatus,
  OpenProjectWorkPackageChanges,
  OpenProjectWorkPackageContent,
} from "./types";

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
  subject: "Add project overview",
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
  assignee: 2,
};

export const changedResponsibleDetails: OpenProjectWorkPackageChanges = {
  responsible: 3,
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
  type: 1,
};

export const clearedOptionalValuesWorkPackage: OpenProjectWorkPackageContent = {
  ...minimalWorkPackage,
  percentageDone: null,
  dueDate: null,
  priority: undefined,
};

export const clearedOptionalValuesDetails: OpenProjectWorkPackageChanges = {
  assignee: 2,
  responsible: 3,
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
  type: { name: "Untrusted type", color: "not-a-color" },
  status: { name: "Untrusted status", color: "rgb(0, 0, 0)" },
  author: { ...author, url: "data:text/html,unsafe" },
};

export const createdContent: OpenProjectContent = {
  "org.matrix.matrix-hookshot.openproject.work_package": minimalWorkPackage,
};

export const describedContent: OpenProjectContent = {
  "org.matrix.matrix-hookshot.openproject.work_package": describedWorkPackage,
};

export const changedContent: OpenProjectContent = {
  "org.matrix.matrix-hookshot.openproject.work_package": changedWorkPackage,
  "org.matrix.matrix-hookshot.openproject.work_package.changed":
    changedStatusDetails,
};
