import type { OpenProjectDescription } from "../../models/OpenProjectMatrixEventContent";

export interface DescriptionSnapshot {
  readonly plain: string;
  readonly html?: string;
}

export function createDescriptionSnapshot(
  description: OpenProjectDescription,
): DescriptionSnapshot {
  return { plain: description.plain, html: description.html };
}
