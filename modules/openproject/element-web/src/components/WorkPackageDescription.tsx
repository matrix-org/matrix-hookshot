import * as React from "react";
import type { OpenProjectDescription } from "./types";
import { WorkPackageDescriptionText } from "./WorkPackageStyles";
import { safeHtml } from "./validation";

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
