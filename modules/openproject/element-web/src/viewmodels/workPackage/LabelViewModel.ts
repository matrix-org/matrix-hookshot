import type { OpenProjectStatus } from "../../models/OpenProjectMatrixEventContent";
import { safeColor } from "../../utils/validation";

export interface LabelViewModel {
  readonly name: string;
  readonly color?: string;
}

export function createLabelViewModel(label: OpenProjectStatus): LabelViewModel {
  return { name: label.name, color: safeColor(label.color) };
}
