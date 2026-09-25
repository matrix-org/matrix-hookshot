import type { OpenProjectStatus } from "../../models/OpenProjectMatrixEventContent";

export interface LabelSnapshot {
  readonly name: string;
  readonly color?: string;
}

export function createLabelSnapshot(label: OpenProjectStatus): LabelSnapshot {
  return { name: label.name, color: label.color };
}
