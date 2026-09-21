import * as React from "react";
import type { WorkPackageNamedColourViewModel } from "../viewmodels/WorkPackageMessageViewModel";
import { WorkPackageStatusIndicator } from "./WorkPackageStyles";

export function WorkPackageStatus({
  status,
}: {
  status: WorkPackageNamedColourViewModel;
}) {
  return (
    <span>
      <WorkPackageStatusIndicator
        {...(status.color ? { style: { background: status.color } } : {})}
      />
      {status.name}
    </span>
  );
}
