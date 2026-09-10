import * as React from "react";
import type { OpenProjectDescription } from "./types";
import { WorkPackageDescriptionText } from "./WorkPackageStyles";
import { safeHtml } from "./validation";

export function WorkPackageDescription({
  description,
  asDetails = false,
}: {
  description: OpenProjectDescription;
  asDetails?: boolean;
}) {
  const descriptionHtml = safeHtml(description.html);

  if (descriptionHtml) {
    if (asDetails) {
      return <details dangerouslySetInnerHTML={{ __html: descriptionHtml }} />;
    }

    return (
      <WorkPackageDescriptionText
        dangerouslySetInnerHTML={{ __html: descriptionHtml }}
      />
    );
  }

  if (asDetails) {
    return <details>{description.plain}</details>;
  }
  if (!description.plain) {
    return null;
  }
  return (
    <WorkPackageDescriptionText>{description.plain}</WorkPackageDescriptionText>
  );
}
