import * as React from "react";
import type { WorkPackageDescriptionViewModel } from "../viewmodels/WorkPackageMessageViewModel";
import { WorkPackageDescriptionText } from "./WorkPackageStyles";

export function WorkPackageDescription({
  description,
}: {
  description: WorkPackageDescriptionViewModel;
}) {
  if (description.html) {
    return (
      <WorkPackageDescriptionText
        dangerouslySetInnerHTML={{ __html: description.html }}
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
