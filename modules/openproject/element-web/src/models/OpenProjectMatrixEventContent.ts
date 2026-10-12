import {
  OPENPROJECT_ANCHOR_EVENT_KIND,
  OPENPROJECT_EVENT_SCHEMA_VERSION,
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

export interface OpenProjectStatus {
  name: string;
  color: string;
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
  "org.matrix.matrix-hookshot.openproject.project"?: {
    id: number;
    name: string;
    url: string;
  };
  "org.matrix.matrix-hookshot.commands"?: {
    "org.matrix.matrix-hookshot.openproject.command.close": {
      label: "Close work package";
    };
  };
  "org.matrix.matrix-hookshot.openproject.work_package.changed"?: OpenProjectWorkPackageChanges;
}

export interface OpenProjectAnchorContent extends OpenProjectContent {
  "org.matrix.matrix-hookshot.openproject.schema_version": typeof OPENPROJECT_EVENT_SCHEMA_VERSION;
  "org.matrix.matrix-hookshot.openproject.event_kind": typeof OPENPROJECT_ANCHOR_EVENT_KIND;
}
