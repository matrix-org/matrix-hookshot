import * as React from "react";
import type { OpenProjectDescription } from "../models/OpenProjectMatrixEventContent";
import { WorkPackageDescriptionText } from "./WorkPackageStyles";
import { safeHtml } from "../utils/validation";

export function WorkPackageDescription({
  description,
}: {
  description: OpenProjectDescription;
}) {
  const descriptionHtml = safeHtml(description.html);

  if (descriptionHtml) {
    return (
      <WorkPackageDescriptionText
        dangerouslySetInnerHTML={{ __html: descriptionHtml }}
      />
    );
  }

  if (!description.plain) {
    return null;
  }
  return (
    <WorkPackageDescriptionText>{description.plain}</WorkPackageDescriptionText>
  );
}
