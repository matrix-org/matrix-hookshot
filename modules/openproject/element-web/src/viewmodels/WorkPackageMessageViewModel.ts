import type {
  OpenProjectContent,
  OpenProjectDescription,
  OpenProjectPerson,
  OpenProjectStatus,
  OpenProjectWorkPackageChanges,
  OpenProjectWorkPackageContent,
} from "../models/OpenProjectMatrixEventContent";
import { safeColor, safeHtml, safeUrl } from "../utils/validation";

export interface WorkPackagePersonViewModel {
  readonly name: string;
  readonly url?: string;
}

export interface WorkPackageNamedColourViewModel {
  readonly name: string;
  readonly color?: string;
}

export interface WorkPackageDescriptionViewModel {
  readonly plain: string;
  readonly html?: string;
}

export interface WorkPackageHeaderViewModel {
  readonly action: "created" | "updated";
  readonly authorName?: string;
}

export interface WorkPackageViewModel {
  readonly id: number;
  readonly subject: string;
  readonly url?: string;
  readonly description: WorkPackageDescriptionViewModel;
  readonly author: WorkPackagePersonViewModel;
  readonly responsible?: WorkPackagePersonViewModel;
  readonly assignee?: WorkPackagePersonViewModel;
  readonly status: WorkPackageNamedColourViewModel;
  readonly type: WorkPackageNamedColourViewModel;
  readonly priority?: WorkPackageNamedColourViewModel;
  readonly percentageDone?: number | null;
  readonly dueDate?: string | null;
}

export type WorkPackageChangedDetailViewModel =
  | { readonly kind: "assignee"; readonly currentName: string }
  | {
      readonly kind: "description";
      readonly description: WorkPackageDescriptionViewModel;
    }
  | {
      readonly kind: "dueDate";
      readonly currentValue: string | null | undefined;
    }
  | {
      readonly kind: "percentageDone";
      readonly currentValue: number | null | undefined;
    }
  | {
      readonly kind: "priority";
      readonly previousName: string;
      readonly currentName: string;
    }
  | { readonly kind: "responsible"; readonly currentName: string }
  | {
      readonly kind: "status";
      readonly previous: WorkPackageNamedColourViewModel;
      readonly current: WorkPackageNamedColourViewModel;
    }
  | { readonly kind: "subject" }
  | { readonly kind: "type"; readonly currentName: string };

interface WorkPackageMessageBaseViewModel {
  readonly workPackage: WorkPackageViewModel;
  readonly header: WorkPackageHeaderViewModel;
}

export interface WorkPackageCreatedMessageViewModel extends WorkPackageMessageBaseViewModel {
  readonly kind: "created";
}

export interface WorkPackageUpdatedMessageViewModel extends WorkPackageMessageBaseViewModel {
  readonly kind: "updated";
  readonly changedDetail?: WorkPackageChangedDetailViewModel;
}

export type WorkPackageMessageViewModel =
  | WorkPackageCreatedMessageViewModel
  | WorkPackageUpdatedMessageViewModel;

function createPersonViewModel(
  person: OpenProjectPerson,
): WorkPackagePersonViewModel {
  return { name: person.name, url: safeUrl(person.url) };
}

function createNamedColourViewModel(
  status: OpenProjectStatus,
): WorkPackageNamedColourViewModel {
  return { name: status.name, color: safeColor(status.color) };
}

function createDescriptionViewModel(
  description: OpenProjectDescription,
): WorkPackageDescriptionViewModel {
  return { plain: description.plain, html: safeHtml(description.html) };
}

function createWorkPackageViewModel(
  workPackage: OpenProjectWorkPackageContent,
): WorkPackageViewModel {
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
    status: createNamedColourViewModel(workPackage.status),
    type: createNamedColourViewModel(workPackage.type),
    priority: workPackage.priority
      ? createNamedColourViewModel(workPackage.priority)
      : undefined,
    percentageDone: workPackage.percentageDone,
    dueDate: workPackage.dueDate,
  };
}

/**
 * Represents the same single changed-field precedence as the existing
 * renderer. Rendering every changed field is intentionally a future
 * behavioural change, not part of this refactor.
 */
function createChangedDetailViewModel(
  workPackage: WorkPackageViewModel,
  changes: OpenProjectWorkPackageChanges,
): WorkPackageChangedDetailViewModel | undefined {
  if (changes.assignee !== undefined) {
    return {
      kind: "assignee",
      currentName: workPackage.assignee?.name ?? "Nobody",
    };
  }
  if (changes.description !== undefined) {
    return { kind: "description", description: workPackage.description };
  }
  if (changes.dueDate !== undefined) {
    return { kind: "dueDate", currentValue: workPackage.dueDate };
  }
  if (changes.percentageDone !== undefined) {
    return { kind: "percentageDone", currentValue: workPackage.percentageDone };
  }
  if (changes.priority !== undefined) {
    return {
      kind: "priority",
      previousName: changes.priority?.name ?? "None",
      currentName: workPackage.priority?.name ?? "None",
    };
  }
  if (changes.responsible !== undefined) {
    return {
      kind: "responsible",
      currentName: workPackage.responsible?.name ?? "Nobody",
    };
  }
  if (changes.status !== undefined) {
    return {
      kind: "status",
      previous: createNamedColourViewModel(changes.status),
      current: workPackage.status,
    };
  }
  if (changes.subject !== undefined) {
    return { kind: "subject" };
  }
  if (changes.type !== undefined) {
    return { kind: "type", currentName: workPackage.type.name };
  }
  return undefined;
}

export function createCreatedWorkPackageMessageViewModel(
  data: OpenProjectContent,
): WorkPackageCreatedMessageViewModel | null {
  const rawWorkPackage =
    data["org.matrix.matrix-hookshot.openproject.work_package"];
  if (!rawWorkPackage) {
    return null;
  }

  const workPackage = createWorkPackageViewModel(rawWorkPackage);
  return {
    kind: "created",
    workPackage,
    header: { action: "created", authorName: workPackage.author.name },
  };
}

export function createUpdatedWorkPackageMessageViewModel(
  data: OpenProjectContent,
): WorkPackageUpdatedMessageViewModel | null {
  const rawWorkPackage =
    data["org.matrix.matrix-hookshot.openproject.work_package"];
  const changes =
    data["org.matrix.matrix-hookshot.openproject.work_package.changed"];
  if (!rawWorkPackage || !changes) {
    return null;
  }

  const workPackage = createWorkPackageViewModel(rawWorkPackage);
  return {
    kind: "updated",
    workPackage,
    header: { action: "updated" },
    changedDetail: createChangedDetailViewModel(workPackage, changes),
  };
}

export function createWorkPackageMessageViewModel(
  data: OpenProjectContent,
): WorkPackageMessageViewModel | null {
  return data["org.matrix.matrix-hookshot.openproject.work_package.changed"]
    ? createUpdatedWorkPackageMessageViewModel(data)
    : createCreatedWorkPackageMessageViewModel(data);
}
