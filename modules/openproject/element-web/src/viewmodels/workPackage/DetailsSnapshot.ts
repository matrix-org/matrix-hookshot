import type {
  OpenProjectPerson,
  OpenProjectWorkPackageContent,
} from "../../models/OpenProjectMatrixEventContent";
import { safeUrl } from "../../utils/validation";
import {
  createDescriptionSnapshot,
  type DescriptionSnapshot,
} from "./DescriptionSnapshot";
import { createLabelSnapshot, type LabelSnapshot } from "./LabelSnapshot";

interface PersonSnapshot {
  readonly name: string;
  readonly url?: string;
}

export interface DetailsSnapshot {
  readonly id: number;
  readonly subject: string;
  readonly url?: string;
  readonly description: DescriptionSnapshot;
  readonly author: PersonSnapshot;
  readonly responsible?: PersonSnapshot;
  readonly assignee?: PersonSnapshot;
  readonly status: LabelSnapshot;
  readonly type: LabelSnapshot;
  readonly priority?: LabelSnapshot;
  readonly percentageDone?: number | null;
  readonly dueDate?: string | null;
}

function createPersonSnapshot(person: OpenProjectPerson): PersonSnapshot {
  return { name: person.name, url: safeUrl(person.url) };
}

export function createDetailsSnapshot(
  workPackage: OpenProjectWorkPackageContent,
): DetailsSnapshot {
  return {
    id: workPackage.id,
    subject: workPackage.subject,
    url: safeUrl(workPackage.url),
    description: createDescriptionSnapshot(workPackage.description),
    author: createPersonSnapshot(workPackage.author),
    responsible: workPackage.responsible
      ? createPersonSnapshot(workPackage.responsible)
      : undefined,
    assignee: workPackage.assignee
      ? createPersonSnapshot(workPackage.assignee)
      : undefined,
    status: createLabelSnapshot(workPackage.status),
    type: createLabelSnapshot(workPackage.type),
    priority: workPackage.priority
      ? createLabelSnapshot(workPackage.priority)
      : undefined,
    percentageDone: workPackage.percentageDone,
    dueDate: workPackage.dueDate,
  };
}
