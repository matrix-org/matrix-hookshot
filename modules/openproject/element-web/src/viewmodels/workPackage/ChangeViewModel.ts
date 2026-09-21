import type { OpenProjectWorkPackageChanges } from "../../models/OpenProjectMatrixEventContent";
import type { DescriptionViewModel } from "./DescriptionViewModel";
import { createLabelViewModel, type LabelViewModel } from "./LabelViewModel";
import type { DetailsViewModel } from "./DetailsViewModel";

export type ChangeViewModel =
  | { readonly kind: "assignee"; readonly currentName: string }
  | {
      readonly kind: "description";
      readonly description: DescriptionViewModel;
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
      readonly previous: LabelViewModel;
      readonly current: LabelViewModel;
    }
  | { readonly kind: "subject" }
  | { readonly kind: "type"; readonly currentName: string };

/**
 * Represents the same single changed-field precedence as the existing
 * renderer. Rendering every changed field is intentionally a future
 * behavioural change, not part of this refactor.
 */
export function createChangeViewModel(
  workPackage: DetailsViewModel,
  changes: OpenProjectWorkPackageChanges,
): ChangeViewModel | undefined {
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
      previous: createLabelViewModel(changes.status),
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
