import type {
  OpenProjectPerson,
  OpenProjectWorkPackageContent,
} from "../../models/OpenProjectMatrixEventContent";
import { safeUrl } from "../../utils/validation";
import {
  createDescriptionViewModel,
  type DescriptionViewModel,
} from "./DescriptionViewModel";
import { createLabelViewModel, type LabelViewModel } from "./LabelViewModel";

interface PersonViewModel {
  readonly name: string;
  readonly url?: string;
}

export interface DetailsViewModel {
  readonly id: number;
  readonly subject: string;
  readonly url?: string;
  readonly description: DescriptionViewModel;
  readonly author: PersonViewModel;
  readonly responsible?: PersonViewModel;
  readonly assignee?: PersonViewModel;
  readonly status: LabelViewModel;
  readonly type: LabelViewModel;
  readonly priority?: LabelViewModel;
  readonly percentageDone?: number | null;
  readonly dueDate?: string | null;
}

function createPersonViewModel(person: OpenProjectPerson): PersonViewModel {
  return { name: person.name, url: safeUrl(person.url) };
}

export function createDetailsViewModel(
  workPackage: OpenProjectWorkPackageContent,
): DetailsViewModel {
  return {
    id: workPackage.id,
    subject: workPackage.subject,
    url: safeUrl(workPackage.url),
    description: createDescriptionViewModel(workPackage.description),
    author: createPersonViewModel(workPackage.author),
    responsible: workPackage.responsible
      ? createPersonViewModel(workPackage.responsible)
      : undefined,
    assignee: workPackage.assignee
      ? createPersonViewModel(workPackage.assignee)
      : undefined,
    status: createLabelViewModel(workPackage.status),
    type: createLabelViewModel(workPackage.type),
    priority: workPackage.priority
      ? createLabelViewModel(workPackage.priority)
      : undefined,
    percentageDone: workPackage.percentageDone,
    dueDate: workPackage.dueDate,
  };
}
