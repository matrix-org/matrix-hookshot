import * as React from "react";
import type { WorkPackageViewModel } from "../viewmodels/WorkPackageMessageViewModel";
import { WorkPackageTitleLink } from "./WorkPackageStyles";

export function WorkPackageTitle({
  workPackage,
}: {
  workPackage: WorkPackageViewModel;
}) {
  if (workPackage.url) {
    return (
      <WorkPackageTitleLink href={workPackage.url}>
        #{workPackage.id} {workPackage.subject}
      </WorkPackageTitleLink>
    );
  }

  return (
    <span>
      #{workPackage.id} {workPackage.subject}
    </span>
  );
}
