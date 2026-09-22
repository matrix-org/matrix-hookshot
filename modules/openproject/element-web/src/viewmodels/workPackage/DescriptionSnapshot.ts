import type { OpenProjectDescription } from "../../models/OpenProjectMatrixEventContent";
import { safeHtml } from "../../utils/validation";

export interface DescriptionSnapshot {
  readonly plain: string;
  readonly html?: string;
}

export function createDescriptionSnapshot(
  description: OpenProjectDescription,
): DescriptionSnapshot {
  // OpenProject event HTML is untrusted. Sanitise it before it can reach a view.
  return { plain: description.plain, html: safeHtml(description.html) };
}
