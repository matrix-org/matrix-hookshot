import type { OpenProjectEventsNames } from "../Connections/OpenProjectConnection";
import type { OpenProjectWorkPackageCacheState } from "./State";
import { workPackageToCacheState } from "./State";
import {
  OPENPROJECT_ANCHOR_EVENT_KIND,
  OPENPROJECT_ANCHOR_STATE_ACTIVE,
  OPENPROJECT_ANCHOR_STATE_INACTIVE,
  OPENPROJECT_EVENT_SCHEMA_VERSION,
  OPENPROJECT_UPDATE_EVENT_KIND,
  type OpenProjectAnchorState,
} from "./Schema";
import type { OpenProjectWebhookActor, OpenProjectWorkPackage } from "./Types";

const DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
  year: "numeric",
});

export interface OpenProjectDeadline {
  date: string;
  label: "Due" | "Date";
}

function getWorkPackageUrl(pkg: OpenProjectWorkPackage, baseURL: URL): string {
  return new URL(
    baseURL.href +
      `projects/${pkg._embedded.project.identifier}/work_packages/${pkg.id}`,
    baseURL,
  ).toString();
}

function formatDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? date : DATE_FORMATTER.format(parsed);
}

function getDeadline(pkg: OpenProjectWorkPackage): OpenProjectDeadline | null {
  // OpenProject's `date` is the milestone date. Prefer it when present so a
  // malformed payload containing both date fields still describes the
  // milestone deadline correctly.
  if (pkg.date !== null) {
    return { date: pkg.date, label: "Date" };
  }
  if (pkg.dueDate !== null) {
    return { date: pkg.dueDate, label: "Due" };
  }
  return null;
}

function getDeadlineFallback(deadline: OpenProjectDeadline | null): string {
  return deadline
    ? `${deadline.label}: ${formatDate(deadline.date)}`
    : "No due date";
}

export function formatWorkPackageFallback(
  pkg: OpenProjectWorkPackage,
  baseURL: URL,
  anchorState: OpenProjectAnchorState = OPENPROJECT_ANCHOR_STATE_ACTIVE,
): string {
  const deadline = getDeadline(pkg);
  const lines = [
    pkg.subject,
    `Assignee: ${pkg._embedded.assignee?.name ?? "Unassigned"}`,
    getDeadlineFallback(deadline),
    `Status: ${pkg._embedded.status.name}`,
    getWorkPackageUrl(pkg, baseURL),
  ];

  if (anchorState === OPENPROJECT_ANCHOR_STATE_INACTIVE) {
    lines.push("Timeline tracking: Removed");
  }

  return lines.join("\n");
}

export interface OpenProjectWorkPackageMatrixEvent {
  "org.matrix.matrix-hookshot.openproject.work_package": {
    id: number;
    subject: string;
    description: {
      plain: string;
      html?: string;
    };
    url: string;
    author: {
      name: string;
      url: string;
    };
    assignee?: {
      name: string;
      url: string;
    };
    dueDate: string | null;
    date: string | null;
    deadline: OpenProjectDeadline | null;
    status: {
      name: string;
      color: string;
      isClosed: boolean;
    };
    type: {
      name: string;
      color: string;
    };
  };
  "org.matrix.matrix-hookshot.openproject.project": {
    id: number;
    name: string;
    url: string;
  };
  external_url: string;
}

export interface OpenProjectActiveWorkPackageAnchorMatrixEvent extends OpenProjectWorkPackageMatrixEvent {
  "org.matrix.matrix-hookshot.openproject.schema_version": typeof OPENPROJECT_EVENT_SCHEMA_VERSION;
  "org.matrix.matrix-hookshot.openproject.event_kind": typeof OPENPROJECT_ANCHOR_EVENT_KIND;
  "org.matrix.matrix-hookshot.openproject.anchor_state": typeof OPENPROJECT_ANCHOR_STATE_ACTIVE;
}

export interface OpenProjectInactiveWorkPackageAnchorMatrixEvent extends OpenProjectWorkPackageMatrixEvent {
  "org.matrix.matrix-hookshot.openproject.schema_version": typeof OPENPROJECT_EVENT_SCHEMA_VERSION;
  "org.matrix.matrix-hookshot.openproject.event_kind": typeof OPENPROJECT_ANCHOR_EVENT_KIND;
  "org.matrix.matrix-hookshot.openproject.anchor_state": typeof OPENPROJECT_ANCHOR_STATE_INACTIVE;
}

export type OpenProjectWorkPackageAnchorMatrixEvent =
  | OpenProjectActiveWorkPackageAnchorMatrixEvent
  | OpenProjectInactiveWorkPackageAnchorMatrixEvent;

export interface OpenProjectWorkPackageUpdateMatrixEvent {
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

export interface OpenProjectActiveAnchorMessageContent extends OpenProjectActiveWorkPackageAnchorMatrixEvent {
  msgtype: "m.notice";
  body: string;
}

export interface OpenProjectInactiveAnchorMessageContent extends OpenProjectInactiveWorkPackageAnchorMatrixEvent {
  msgtype: "m.notice";
  body: string;
}

export type OpenProjectAnchorMessageContent =
  | OpenProjectActiveAnchorMessageContent
  | OpenProjectInactiveAnchorMessageContent;

export interface OpenProjectAnchorReplacementMessageContent {
  msgtype: "m.notice";
  body: string;
  "m.new_content": OpenProjectAnchorMessageContent;
  "m.relates_to": {
    rel_type: "m.replace";
    event_id: string;
  };
}

export interface OpenProjectUpdateMessageContent extends OpenProjectWorkPackageUpdateMatrixEvent {
  msgtype: "m.notice";
  body: string;
}

export function formatWorkPackageForMatrix(
  pkg: OpenProjectWorkPackage,
  baseURL: URL,
): OpenProjectWorkPackageMatrixEvent {
  const url = getWorkPackageUrl(pkg, baseURL);
  return {
    "org.matrix.matrix-hookshot.openproject.work_package": {
      id: pkg.id,
      subject: pkg.subject,
      description: {
        plain: pkg.description.raw,
        html: pkg.description.html,
      },
      url,
      author: {
        name: pkg._embedded.author.name,
        url: new URL(
          baseURL.href + `users/${pkg._embedded.author.id}`,
          baseURL,
        ).toString(),
      },
      assignee: pkg._embedded.assignee && {
        name: pkg._embedded.assignee.name,
        url: new URL(
          baseURL.href + `users/${pkg._embedded.assignee.id}`,
          baseURL,
        ).toString(),
      },
      dueDate: pkg.dueDate,
      date: pkg.date,
      deadline: getDeadline(pkg),
      status: {
        name: pkg._embedded.status.name,
        color: pkg._embedded.status.color,
        isClosed: pkg._embedded.status.isClosed,
      },
      type: {
        name: pkg._embedded.type.name,
        color: pkg._embedded.type.color,
      },
    },
    "org.matrix.matrix-hookshot.openproject.project": {
      id: pkg._embedded.project.id,
      name: pkg._embedded.project.name,
      url: new URL(
        baseURL.href + `projects/${pkg._embedded.project.id}`,
        baseURL,
      ).toString(),
    },
    external_url: url,
  };
}

export function formatWorkPackageAnchorForMatrix(
  pkg: OpenProjectWorkPackage,
  baseURL: URL,
  anchorState: OpenProjectAnchorState = OPENPROJECT_ANCHOR_STATE_ACTIVE,
): OpenProjectWorkPackageAnchorMatrixEvent {
  return {
    ...formatWorkPackageForMatrix(pkg, baseURL),
    "org.matrix.matrix-hookshot.openproject.schema_version":
      OPENPROJECT_EVENT_SCHEMA_VERSION,
    "org.matrix.matrix-hookshot.openproject.event_kind":
      OPENPROJECT_ANCHOR_EVENT_KIND,
    "org.matrix.matrix-hookshot.openproject.anchor_state": anchorState,
  };
}

/**
 * Build the complete content used for an anchor event or m.new_content.
 * Matrix replacements do not merge content, so callers must use this whole
 * object rather than only the structured snapshot.
 */
export function formatWorkPackageAnchorContent(
  pkg: OpenProjectWorkPackage,
  baseURL: URL,
  anchorState: OpenProjectAnchorState = OPENPROJECT_ANCHOR_STATE_ACTIVE,
): OpenProjectAnchorMessageContent {
  return {
    msgtype: "m.notice",
    body: formatWorkPackageFallback(pkg, baseURL, anchorState),
    ...formatWorkPackageAnchorForMatrix(pkg, baseURL, anchorState),
  };
}

export function formatWorkPackageAnchorReplacement(
  anchorEventId: string,
  pkg: OpenProjectWorkPackage,
  baseURL: URL,
  anchorState: OpenProjectAnchorState = OPENPROJECT_ANCHOR_STATE_ACTIVE,
): OpenProjectAnchorReplacementMessageContent {
  const newContent = formatWorkPackageAnchorContent(pkg, baseURL, anchorState);

  return {
    msgtype: "m.notice",
    body: `* ${newContent.body}`,
    "m.new_content": newContent,
    "m.relates_to": {
      rel_type: "m.replace",
      event_id: anchorEventId,
    },
  };
}

function formatUpdateFallback(
  pkg: OpenProjectWorkPackage,
  baseURL: URL,
  changes: string[],
  actor?: OpenProjectWebhookActor,
): string {
  const firstChange = changes[0] ?? "updated the work package";
  const remainingChanges = changes.length - 1;
  const remainingSummary =
    remainingChanges > 0
      ? ` and made ${remainingChanges} more ${remainingChanges === 1 ? "update" : "updates"}`
      : "";
  const changeSummary = `${firstChange}${remainingSummary}`;
  const body = actor
    ? `${actor.name} ${changeSummary} on work package #${pkg.id}: "${pkg.subject}"`
    : `Work package #${pkg.id}: ${changeSummary} ("${pkg.subject}")`;
  return `${body}\n${getWorkPackageUrl(pkg, baseURL)}`;
}

export function formatWorkPackageUpdateForMatrix(
  pkg: OpenProjectWorkPackage,
  baseURL: URL,
  changes: string[],
  actor?: OpenProjectWebhookActor,
): OpenProjectUpdateMessageContent {
  const content: OpenProjectUpdateMessageContent = {
    msgtype: "m.notice",
    body: formatUpdateFallback(pkg, baseURL, changes, actor),
    "org.matrix.matrix-hookshot.openproject.work_package": {
      id: pkg.id,
      subject: pkg.subject,
      url: getWorkPackageUrl(pkg, baseURL),
    },
    "org.matrix.matrix-hookshot.openproject.changes": changes,
    "org.matrix.matrix-hookshot.openproject.schema_version":
      OPENPROJECT_EVENT_SCHEMA_VERSION,
    "org.matrix.matrix-hookshot.openproject.event_kind":
      OPENPROJECT_UPDATE_EVENT_KIND,
  };

  if (actor) {
    content["org.matrix.matrix-hookshot.openproject.actor"] = {
      id: actor.id,
      name: actor.name,
      url: new URL(baseURL.href + `users/${actor.id}`, baseURL).toString(),
    };
  }

  return content;
}

export function formatWorkPackageDiff(
  old: OpenProjectWorkPackageCacheState,
  pkg: OpenProjectWorkPackage,
): {
  changes: string[];
  postfix?: string;
  eventKind: OpenProjectEventsNames;
} | null {
  const changes: string[] = [];
  let postfix: undefined | string;
  let eventKind: OpenProjectEventsNames = "work_package:updated";
  const current = workPackageToCacheState(pkg);
  // {user} {...changes} {issueUrl}
  if (old.assignee !== current.assignee) {
    if (current.assignee) {
      changes.push(`assigned **${pkg._embedded.assignee?.name}**`);
    } else {
      changes.push(`removed assignee`);
    }
    eventKind = "work_package:assignee_changed";
  }
  if (old.description.raw !== current.description.raw) {
    if (current.description) {
      changes.push(`updated the description`);
      postfix = current.description.raw;
    } else {
      changes.push(`removed the description`);
    }
    eventKind = "work_package:description_changed";
  }
  if (old.dueDate !== current.dueDate) {
    if (current.dueDate) {
      changes.push(`set the due date to \`${current.dueDate}\``);
    } else {
      changes.push(`removed the due date`);
    }
    eventKind = "work_package:duedate_changed";
  }
  if (old.percentageDone !== current.percentageDone) {
    if (current.percentageDone) {
      changes.push(
        `set the work completed percentage to **${current.percentageDone}%**`,
      );
    }
    // No point sending anything about removal.
    eventKind = "work_package:workpercent_changed";
  }
  if (old.priority?.id !== current.priority?.id) {
    changes.push(
      `changed the priority from **${old.priority?.name}** to **${current.priority?.name ?? "none"}**`,
    );
    eventKind = "work_package:priority_changed";
  }
  if (old.responsible !== current.responsible) {
    if (current.responsible) {
      changes.push(`set ${pkg._embedded.responsible?.name} as responsible`);
    } else {
      changes.push(`removed responsible user`);
    }
    eventKind = "work_package:responsible_changed";
  }
  if (old.status.id !== current.status.id) {
    changes.push(
      `changed the status from **${old.status?.name}** to **${current.status?.name ?? "none"}**`,
    );
  }
  if (old.subject !== current.subject) {
    // Implicitly named
    changes.push(`updated the subject`);
    eventKind = "work_package:subject_changed";
  }
  if (old.type !== current.type) {
    changes.push(`changed the type to **${current.type}**`);
  }

  if (changes.length === 0) {
    // Unknown change
    return null;
  }
  return {
    changes,
    postfix,
    eventKind,
  };
}
