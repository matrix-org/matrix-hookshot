import {
  OPENPROJECT_ANCHOR_EVENT_KIND,
  OPENPROJECT_ANCHOR_STATE_ACTIVE,
  OPENPROJECT_ANCHOR_STATE_INACTIVE,
  OPENPROJECT_EVENT_SCHEMA_VERSION,
  OPENPROJECT_UPDATE_EVENT_KIND,
} from "../OpenProjectSchema";

/**
 * The Matrix event DTOs emitted by Hookshot for OpenProject work packages.
 *
 * These deliberately model the event payload rather than the presentation of
 * that payload. Views validate values immediately before rendering them.
 */
export interface OpenProjectDescription {
  plain: string;
  html?: string;
}

export interface OpenProjectPerson {
  name: string;
  url: string;
}

export interface OpenProjectProjectContent {
  id: number;
  name: string;
  url: string;
}

export interface OpenProjectStatus {
  name: string;
  color: string;
  isClosed?: boolean;
}

export interface OpenProjectDeadline {
  date: string;
  label: "Due" | "Date";
}

export interface OpenProjectWorkPackageContent {
  id: number;
  subject: string;
  description: OpenProjectDescription;
  url: string;
  author: OpenProjectPerson;
  responsible?: OpenProjectPerson;
  assignee?: OpenProjectPerson;
  status: OpenProjectStatus;
  type: OpenProjectStatus;
  priority?: OpenProjectStatus;
  percentageDone?: number | null;
  dueDate?: string | null;
  date?: string | null;
  deadline?: OpenProjectDeadline | null;
}

export interface OpenProjectSnapshotWorkPackageContent extends OpenProjectWorkPackageContent {
  dueDate: string | null;
  date: string | null;
  deadline: OpenProjectDeadline | null;
  status: OpenProjectStatus & { isClosed: boolean };
}

export interface OpenProjectWorkPackageChanges {
  subject?: string;
  description?: OpenProjectDescription;
  assignee?: OpenProjectPerson;
  status?: OpenProjectStatus;
  type?: OpenProjectStatus;
  responsible?: OpenProjectPerson;
  priority?: OpenProjectStatus;
  percentageDone?: number | null;
  dueDate?: string | null;
}

export interface OpenProjectContent {
  "org.matrix.matrix-hookshot.openproject.work_package"?: OpenProjectWorkPackageContent;
  "org.matrix.matrix-hookshot.openproject.project"?: OpenProjectProjectContent;
  "org.matrix.matrix-hookshot.commands"?: {
    "org.matrix.matrix-hookshot.openproject.command.close": {
      label: "Close work package";
    };
  };
  "org.matrix.matrix-hookshot.openproject.work_package.changed"?: OpenProjectWorkPackageChanges;
}

type OpenProjectContentWithoutWorkPackage = Omit<
  OpenProjectContent,
  "org.matrix.matrix-hookshot.openproject.work_package"
>;

export interface OpenProjectActiveAnchorContent extends OpenProjectContentWithoutWorkPackage {
  "org.matrix.matrix-hookshot.openproject.work_package": OpenProjectSnapshotWorkPackageContent;
  "org.matrix.matrix-hookshot.openproject.schema_version": typeof OPENPROJECT_EVENT_SCHEMA_VERSION;
  "org.matrix.matrix-hookshot.openproject.event_kind": typeof OPENPROJECT_ANCHOR_EVENT_KIND;
  "org.matrix.matrix-hookshot.openproject.anchor_state": typeof OPENPROJECT_ANCHOR_STATE_ACTIVE;
  "org.matrix.matrix-hookshot.openproject.snapshot_id": string;
}

export interface OpenProjectInactiveAnchorContent extends OpenProjectContentWithoutWorkPackage {
  "org.matrix.matrix-hookshot.openproject.work_package": OpenProjectSnapshotWorkPackageContent;
  "org.matrix.matrix-hookshot.openproject.schema_version": typeof OPENPROJECT_EVENT_SCHEMA_VERSION;
  "org.matrix.matrix-hookshot.openproject.event_kind": typeof OPENPROJECT_ANCHOR_EVENT_KIND;
  "org.matrix.matrix-hookshot.openproject.anchor_state": typeof OPENPROJECT_ANCHOR_STATE_INACTIVE;
  "org.matrix.matrix-hookshot.openproject.snapshot_id": string;
}

export type OpenProjectAnchorContent =
  | OpenProjectActiveAnchorContent
  | OpenProjectInactiveAnchorContent;

export interface OpenProjectUpdateContent extends OpenProjectContentWithoutWorkPackage {
  "org.matrix.matrix-hookshot.openproject.work_package": {
    id: number;
    subject: string;
    url: string;
  };
  "org.matrix.matrix-hookshot.openproject.actor"?: {
    id: number;
    name: string;
    url: string;
  };
  "org.matrix.matrix-hookshot.openproject.changes": string[];
  "org.matrix.matrix-hookshot.openproject.schema_version": typeof OPENPROJECT_EVENT_SCHEMA_VERSION;
  "org.matrix.matrix-hookshot.openproject.event_kind": typeof OPENPROJECT_UPDATE_EVENT_KIND;
}
