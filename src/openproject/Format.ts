import { OpenProjectEventsNames } from "../Connections/OpenProjectConnection";
import {
  OpenProjectWorkPackageCacheState,
  workPackageToCacheState,
} from "./State";
import { OpenProjectWorkPackage } from "./Types";

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
    status: {
      name: string;
      color: string;
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

export function formatWorkPackageForMatrix(
  pkg: OpenProjectWorkPackage,
  baseURL: URL,
): OpenProjectWorkPackageMatrixEvent {
  const url = new URL(
    baseURL.href +
      `projects/${pkg._embedded.project.identifier}/work_packages/${pkg.id}`,
    baseURL,
  ).toString();
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
        name: pkg._embedded.assignee?.name,
        url: new URL(
          baseURL.href + `users/${pkg._embedded.assignee?.id}`,
          baseURL,
        ).toString(),
      },
      status: {
        name: pkg._embedded.status.name,
        color: pkg._embedded.status.color,
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
    // Implictly named
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
