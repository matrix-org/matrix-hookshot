/**
 * Real Hookshot formatter output used by the Element renderer tests. These
 * fixtures stay in tests so the browser module never imports server code.
 */
import {
  formatInactiveWorkPackageAnchorReplacement,
  formatWorkPackageAnchorContent,
  formatWorkPackageAnchorReplacement,
  formatWorkPackageUpdateForMatrix,
} from "../../../../../src/openproject/Format";
import {
  BASE_URL,
  WORK_PACKAGE,
} from "../../../../../tests/openproject/WorkPackageFixtures";

export const anchorEventId = "$openproject-anchor-50:example.org";

const initialWorkPackage = {
  ...WORK_PACKAGE,
  dueDate: "2026-09-30",
};

const updatedWorkPackage = {
  ...WORK_PACKAGE,
  subject: "Build the updated bridge",
  date: "2026-10-15",
  dueDate: null,
  _embedded: {
    ...WORK_PACKAGE._embedded,
    assignee: undefined,
    status: {
      ...WORK_PACKAGE._embedded.status,
      name: "Closed",
      isClosed: true,
    },
  },
};

export const activeAnchorContent = formatWorkPackageAnchorContent(
  initialWorkPackage,
  BASE_URL,
  { snapshotId: "00000000-0000-4000-8000-000000000001" },
);

export const noDeadlineAnchorContent = formatWorkPackageAnchorContent(
  WORK_PACKAGE,
  BASE_URL,
  { snapshotId: "00000000-0000-4000-8000-000000000004" },
);

export const updatedAnchorContent = formatWorkPackageAnchorContent(
  updatedWorkPackage,
  BASE_URL,
  { snapshotId: "00000000-0000-4000-8000-000000000002" },
);

export const activeReplacement = formatWorkPackageAnchorReplacement(
  anchorEventId,
  updatedWorkPackage,
  BASE_URL,
  { snapshotId: "00000000-0000-4000-8000-000000000002" },
);

export const inactiveReplacement = formatInactiveWorkPackageAnchorReplacement(
  anchorEventId,
  updatedAnchorContent,
  "00000000-0000-4000-8000-000000000003",
);

export const compactUpdateContent = formatWorkPackageUpdateForMatrix(
  updatedWorkPackage,
  BASE_URL,
  ["updated the subject"],
  { id: 12, name: "Webhook actor" },
);
