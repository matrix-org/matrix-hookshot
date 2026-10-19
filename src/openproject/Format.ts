import markdown from "markdown-it";
import type { OpenProjectEventsNames } from "../Connections/OpenProjectConnection";
import type { OpenProjectWorkPackageCacheState } from "./State";
import { workPackageToCacheState } from "./State";
import {
  OPENPROJECT_ANCHOR_EVENT_KIND,
  OPENPROJECT_ANCHOR_STATE_ACTIVE,
  OPENPROJECT_ANCHOR_STATE_INACTIVE,
  OPENPROJECT_EVENT_SCHEMA_VERSION,
  OPENPROJECT_ACTIVITY_EVENT_KIND,
  type OpenProjectAnchorState,
} from "./Schema";
import type { OpenProjectWebhookActor, OpenProjectWorkPackage } from "./Types";

const md = new markdown();

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

function getDeadline(pkg: OpenProjectWorkPackage): OpenProjectDeadline | null {
  // OpenProject's `date` is the milestone date. Prefer it when present so a
  // malformed payload containing both date fields still describes the
  // milestone deadline correctly.
  if (pkg.date !== null && pkg.date !== undefined) {
    return { date: pkg.date, label: "Date" };
  }
  if (pkg.dueDate !== null && pkg.dueDate !== undefined) {
    return { date: pkg.dueDate, label: "Due" };
  }
  return null;
}

export function formatWorkPackageFallback(
  pkg: OpenProjectWorkPackage,
  baseURL: URL,
  anchorState: OpenProjectAnchorState = OPENPROJECT_ANCHOR_STATE_ACTIVE,
): string {
  const timelineState =
    anchorState === OPENPROJECT_ANCHOR_STATE_INACTIVE
      ? "removed from the timeline"
      : "added to the timeline";

  return `Work package [${pkg.id}](${getWorkPackageUrl(pkg, baseURL)}): "${pkg.subject}" — ${timelineState}`;
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
    responsible?: {
      name: string;
      url: string;
    };
    priority?: {
      name: string;
      color: string;
    };
    percentageDone: number | null;
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
  "org.matrix.matrix-hookshot.openproject.snapshot_id": string;
}

export interface OpenProjectInactiveWorkPackageAnchorMatrixEvent extends OpenProjectWorkPackageMatrixEvent {
  "org.matrix.matrix-hookshot.openproject.schema_version": typeof OPENPROJECT_EVENT_SCHEMA_VERSION;
  "org.matrix.matrix-hookshot.openproject.event_kind": typeof OPENPROJECT_ANCHOR_EVENT_KIND;
  "org.matrix.matrix-hookshot.openproject.anchor_state": typeof OPENPROJECT_ANCHOR_STATE_INACTIVE;
  "org.matrix.matrix-hookshot.openproject.snapshot_id": string;
}

export type OpenProjectWorkPackageAnchorMatrixEvent =
  | OpenProjectActiveWorkPackageAnchorMatrixEvent
  | OpenProjectInactiveWorkPackageAnchorMatrixEvent;

export interface OpenProjectAnchorFormatOptions {
  snapshotId: string;
  anchorState?: OpenProjectAnchorState;
}

export interface OpenProjectWorkPackageActivityMatrixEvent {
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
  "org.matrix.matrix-hookshot.openproject.event_kind": typeof OPENPROJECT_ACTIVITY_EVENT_KIND;
  "org.matrix.matrix-hookshot.openproject.anchor_event_id"?: string;
  external_url: string;
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

export interface OpenProjectActivityMessageContent extends OpenProjectWorkPackageActivityMatrixEvent {
  msgtype: "m.notice";
  body: string;
  format: "org.matrix.custom.html";
  formatted_body: string;
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
      assignee: pkg._embedded.assignee
        ? {
            name: pkg._embedded.assignee.name,
            url: new URL(
              baseURL.href + `users/${pkg._embedded.assignee.id}`,
              baseURL,
            ).toString(),
          }
        : undefined,
      responsible: pkg._embedded.responsible
        ? {
            name: pkg._embedded.responsible.name,
            url: new URL(
              baseURL.href + `users/${pkg._embedded.responsible.id}`,
              baseURL,
            ).toString(),
          }
        : undefined,
      priority: pkg._embedded.priority
        ? {
            name: pkg._embedded.priority.name,
            color: pkg._embedded.priority.color,
          }
        : undefined,
      percentageDone: pkg.percentageDone ?? null,
      dueDate: pkg.dueDate ?? null,
      date: pkg.date ?? null,
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
  {
    snapshotId,
    anchorState = OPENPROJECT_ANCHOR_STATE_ACTIVE,
  }: OpenProjectAnchorFormatOptions,
): OpenProjectWorkPackageAnchorMatrixEvent {
  return {
    ...formatWorkPackageForMatrix(pkg, baseURL),
    "org.matrix.matrix-hookshot.openproject.schema_version":
      OPENPROJECT_EVENT_SCHEMA_VERSION,
    "org.matrix.matrix-hookshot.openproject.event_kind":
      OPENPROJECT_ANCHOR_EVENT_KIND,
    "org.matrix.matrix-hookshot.openproject.anchor_state": anchorState,
    "org.matrix.matrix-hookshot.openproject.snapshot_id": snapshotId,
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
  options: OpenProjectAnchorFormatOptions & {
    anchorState?: typeof OPENPROJECT_ANCHOR_STATE_ACTIVE;
  },
): OpenProjectActiveAnchorMessageContent;
export function formatWorkPackageAnchorContent(
  pkg: OpenProjectWorkPackage,
  baseURL: URL,
  options: OpenProjectAnchorFormatOptions & {
    anchorState: typeof OPENPROJECT_ANCHOR_STATE_INACTIVE;
  },
): OpenProjectInactiveAnchorMessageContent;
export function formatWorkPackageAnchorContent(
  pkg: OpenProjectWorkPackage,
  baseURL: URL,
  options: OpenProjectAnchorFormatOptions,
): OpenProjectAnchorMessageContent;
export function formatWorkPackageAnchorContent(
  pkg: OpenProjectWorkPackage,
  baseURL: URL,
  options: OpenProjectAnchorFormatOptions,
): OpenProjectAnchorMessageContent {
  const { anchorState = OPENPROJECT_ANCHOR_STATE_ACTIVE } = options;
  return {
    msgtype: "m.notice",
    body: formatWorkPackageFallback(pkg, baseURL, anchorState),
    ...formatWorkPackageAnchorForMatrix(pkg, baseURL, options),
  };
}

export function formatWorkPackageAnchorReplacement(
  anchorEventId: string,
  pkg: OpenProjectWorkPackage,
  baseURL: URL,
  options: OpenProjectAnchorFormatOptions & {
    anchorState?: typeof OPENPROJECT_ANCHOR_STATE_ACTIVE;
  },
): OpenProjectAnchorReplacementMessageContent & {
  "m.new_content": OpenProjectActiveAnchorMessageContent;
};
export function formatWorkPackageAnchorReplacement(
  anchorEventId: string,
  pkg: OpenProjectWorkPackage,
  baseURL: URL,
  options: OpenProjectAnchorFormatOptions & {
    anchorState: typeof OPENPROJECT_ANCHOR_STATE_INACTIVE;
  },
): OpenProjectAnchorReplacementMessageContent & {
  "m.new_content": OpenProjectInactiveAnchorMessageContent;
};
export function formatWorkPackageAnchorReplacement(
  anchorEventId: string,
  pkg: OpenProjectWorkPackage,
  baseURL: URL,
  options: OpenProjectAnchorFormatOptions,
): OpenProjectAnchorReplacementMessageContent {
  const newContent = formatWorkPackageAnchorContent(pkg, baseURL, options);

  return {
    msgtype: "m.notice",
    body: `${newContent.body}`,
    "m.new_content": newContent,
    "m.relates_to": {
      rel_type: "m.replace",
      event_id: anchorEventId,
    },
  };
}

/**
 * Build the final inactive replacement from the last committed active snapshot.
 * Removal changes only the timeline state, fallback, and snapshot identity.
 */
export function formatInactiveWorkPackageAnchorReplacement(
  anchorEventId: string,
  lastActiveContent: OpenProjectActiveAnchorMessageContent,
  snapshotId: string,
): OpenProjectAnchorReplacementMessageContent {
  const workPackage =
    lastActiveContent["org.matrix.matrix-hookshot.openproject.work_package"];
  const body = `Work package [${workPackage.id}](${workPackage.url}): "${workPackage.subject}" — removed from the timeline`;
  const inactiveContent: OpenProjectInactiveAnchorMessageContent = {
    ...lastActiveContent,
    "org.matrix.matrix-hookshot.openproject.work_package": {
      ...workPackage,
      assignee: workPackage.assignee ?? undefined,
      dueDate: workPackage.dueDate ?? null,
      date: workPackage.date ?? null,
      deadline: workPackage.deadline ?? null,
    },
    body,
    "org.matrix.matrix-hookshot.openproject.anchor_state":
      OPENPROJECT_ANCHOR_STATE_INACTIVE,
    "org.matrix.matrix-hookshot.openproject.snapshot_id": snapshotId,
  };

  return {
    msgtype: "m.notice",
    body: `${body}`,
    "m.new_content": inactiveContent,
    "m.relates_to": {
      rel_type: "m.replace",
      event_id: anchorEventId,
    },
  };
}

export interface OpenProjectActivityFormatOptions {
  actor?: OpenProjectWebhookActor;
  anchorEventId?: string;
  created?: boolean;
}

function formatActivityFallback(
  pkg: OpenProjectWorkPackage,
  baseURL: URL,
  changes: string[],
  { actor, created = false }: OpenProjectActivityFormatOptions,
): string {
  const workPackageUrl = getWorkPackageUrl(pkg, baseURL);
  const actorName = `**${actor?.name ?? "Someone"}**`;

  if (created) {
    return `${actorName} created [#${pkg.id} ${pkg.subject}](${workPackageUrl})`;
  }

  const firstChange = changes[0] ?? "updated the details";
  const remainingChanges = changes.length - 1;
  const remainingSummary =
    remainingChanges > 0
      ? ` and made ${remainingChanges == 1 ? "one" : remainingChanges} more ${remainingChanges === 1 ? "update to " : "updates to "}`
      : " on ";
  const changeSummary = `${firstChange}${remainingSummary}`;

  return `${actorName} ${changeSummary} [#${pkg.id} ${pkg.subject}](${workPackageUrl})`;
}

export function formatWorkPackageActivityForMatrix(
  pkg: OpenProjectWorkPackage,
  baseURL: URL,
  changes: string[],
  options: OpenProjectActivityFormatOptions = {},
): OpenProjectActivityMessageContent {
  const body = formatActivityFallback(pkg, baseURL, changes, options);
  const url = getWorkPackageUrl(pkg, baseURL);
  const content: OpenProjectActivityMessageContent = {
    msgtype: "m.notice",
    body,
    format: "org.matrix.custom.html",
    formatted_body: md.renderInline(body),
    "org.matrix.matrix-hookshot.openproject.work_package": {
      id: pkg.id,
      subject: pkg.subject,
      url: url,
    },
    "org.matrix.matrix-hookshot.openproject.changes": changes,
    "org.matrix.matrix-hookshot.openproject.schema_version":
      OPENPROJECT_EVENT_SCHEMA_VERSION,
    "org.matrix.matrix-hookshot.openproject.event_kind":
      OPENPROJECT_ACTIVITY_EVENT_KIND,
    external_url: url,
  };

  if (options.actor) {
    content["org.matrix.matrix-hookshot.openproject.actor"] = {
      id: options.actor.id,
      name: options.actor.name,
      url: new URL(
        baseURL.href + `users/${options.actor.id}`,
        baseURL,
      ).toString(),
    };
  }
  if (options.anchorEventId) {
    content["org.matrix.matrix-hookshot.openproject.anchor_event_id"] =
      options.anchorEventId;
  }

  return content;
}

export function formatWorkPackageDiff(
  old: OpenProjectWorkPackageCacheState,
  pkg: OpenProjectWorkPackage,
): {
  categories: OpenProjectEventsNames[];
  changes: string[];
} | null {
  const changes: string[] = [];
  const categories = new Set<OpenProjectEventsNames>();
  const current = workPackageToCacheState(pkg);
  // {user} {...changes} {issueUrl}
  if (old.assignee !== current.assignee) {
    if (current.assignee) {
      changes.push(`assigned **${pkg._embedded.assignee?.name}**`);
    } else {
      changes.push(`removed assignee`);
    }
    categories.add("work_package:assignee_changed");
  }
  if (old.description.raw !== current.description.raw) {
    if (current.description.raw) {
      changes.push(`updated the description`);
    } else {
      changes.push(`removed the description`);
    }
    categories.add("work_package:description_changed");
  }
  if (old.date !== current.date) {
    if (current.date) {
      changes.push(`set the date to **${current.date}**`);
    } else {
      changes.push(`removed the date`);
    }
    categories.add("work_package:duedate_changed");
  }
  if (old.dueDate !== current.dueDate) {
    if (current.dueDate) {
      changes.push(`set the due date to **${current.dueDate}**`);
    } else {
      changes.push(`removed the due date`);
    }
    categories.add("work_package:duedate_changed");
  }
  if (old.percentageDone !== current.percentageDone) {
    if (current.percentageDone !== null) {
      changes.push(
        `set the work completed percentage to **${current.percentageDone}%**`,
      );
    } else {
      changes.push(`cleared the work completed percentage`);
    }
    categories.add("work_package:workpercent_changed");
  }
  if (old.priority?.id !== current.priority?.id) {
    changes.push(
      `changed the priority from **${old.priority?.name}** to **${current.priority?.name ?? "none"}**`,
    );
    categories.add("work_package:priority_changed");
  }
  if (old.responsible !== current.responsible) {
    if (current.responsible) {
      changes.push(`set ${pkg._embedded.responsible?.name} as responsible`);
    } else {
      changes.push(`removed responsible user`);
    }
    categories.add("work_package:responsible_changed");
  }
  if (old.status.id !== current.status.id) {
    changes.push(
      `changed the status from **${old.status?.name}** to **${current.status?.name ?? "none"}**`,
    );
    categories.add("work_package:updated");
  }
  if (old.subject !== current.subject) {
    // Implicitly named
    changes.push(`updated the subject`);
    categories.add("work_package:subject_changed");
  }
  if (old.type !== current.type) {
    changes.push(`changed the type to **${pkg._embedded.type.name}**`);
    categories.add("work_package:updated");
  }

  if (changes.length === 0) {
    // Unknown change
    return null;
  }
  return {
    categories: [...categories],
    changes,
  };
}
