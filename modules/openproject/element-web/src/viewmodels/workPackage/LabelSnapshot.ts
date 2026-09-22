import type { OpenProjectStatus } from "../../models/OpenProjectMatrixEventContent";
import { safeColor } from "../../utils/validation";

export interface LabelSnapshot {
  readonly name: string;
  readonly color?: string;
}

export function createLabelSnapshot(label: OpenProjectStatus): LabelSnapshot {
  return { name: label.name, color: safeColor(label.color) };
}
