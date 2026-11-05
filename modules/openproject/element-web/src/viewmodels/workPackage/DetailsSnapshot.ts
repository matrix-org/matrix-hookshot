import type {
  OpenProjectDeadline,
  OpenProjectPerson,
  OpenProjectProjectContent,
  OpenProjectWorkPackageContent,
} from "../../models/OpenProjectMatrixEventContent";
import {
  createDescriptionSnapshot,
  type DescriptionSnapshot,
} from "./DescriptionSnapshot";
import { createLabelSnapshot, type LabelSnapshot } from "./LabelSnapshot";

interface PersonSnapshot {
  readonly name: string;
  readonly url?: string;
}

const DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

export interface DeadlineSnapshot {
  readonly label?: OpenProjectDeadline["label"];
  readonly date: string;
}

export interface StatusSnapshot extends LabelSnapshot {
  readonly isClosed?: boolean;
}

export interface DetailsSnapshot {
  readonly id: number;
  readonly project?: string;
  readonly subject: string;
  readonly url?: string;
  readonly description: DescriptionSnapshot;
  readonly author: PersonSnapshot;
  readonly responsible?: PersonSnapshot;
  readonly assignee?: PersonSnapshot;
  readonly status: StatusSnapshot;
  readonly type: LabelSnapshot;
  readonly priority?: LabelSnapshot;
  readonly percentageDone?: number | null;
  readonly dueDate?: string | null;
  readonly date?: string | null;
  readonly deadline?: DeadlineSnapshot;
}

function createPersonSnapshot(person: OpenProjectPerson): PersonSnapshot {
  return { name: person.name, url: person.url };
}

function createDeadlineSnapshot(
  deadline: OpenProjectDeadline | null | undefined,
): DeadlineSnapshot | undefined {
  if (deadline === undefined) {
    return undefined;
  }

  if (deadline === null) {
    return { date: "No due date" };
  }

  const parsed = new Date(`${deadline.date}T00:00:00Z`);
  return {
    label: deadline.label,
    date: Number.isNaN(parsed.getTime())
      ? deadline.date
      : DATE_FORMATTER.format(parsed),
  };
}

export function createDetailsSnapshot({
  workPackage,
  project,
}: {
  workPackage: OpenProjectWorkPackageContent;
  project: OpenProjectProjectContent;
}): DetailsSnapshot {
  return {
    id: workPackage.id,
    project: project.name,
    subject: workPackage.subject,
    url: workPackage.url,
    description: createDescriptionSnapshot(workPackage.description),
    author: createPersonSnapshot(workPackage.author),
    responsible: workPackage.responsible
      ? createPersonSnapshot(workPackage.responsible)
      : undefined,
    assignee: workPackage.assignee
      ? createPersonSnapshot(workPackage.assignee)
      : undefined,
    status: {
      ...createLabelSnapshot(workPackage.status),
      ...(workPackage.status.isClosed === undefined
        ? {}
        : { isClosed: workPackage.status.isClosed }),
    },
    type: createLabelSnapshot(workPackage.type),
    priority: workPackage.priority
      ? createLabelSnapshot(workPackage.priority)
      : undefined,
    percentageDone: workPackage.percentageDone,
    dueDate: workPackage.dueDate,
    date: workPackage.date,
    deadline: createDeadlineSnapshot(workPackage.deadline),
  };
}
