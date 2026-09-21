import type { OpenProjectDescription } from "../../models/OpenProjectMatrixEventContent";
import { safeHtml } from "../../utils/validation";

export interface DescriptionViewModel {
  readonly plain: string;
  readonly html?: string;
}

export function createDescriptionViewModel(
  description: OpenProjectDescription,
): DescriptionViewModel {
  return { plain: description.plain, html: safeHtml(description.html) };
}
