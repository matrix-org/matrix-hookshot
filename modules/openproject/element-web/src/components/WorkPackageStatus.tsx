import * as React from "react";
import type { OpenProjectStatus } from "./types";
import { safeColor } from "./validation";
import { WorkPackageStatusIndicator } from "./WorkPackageStyles";

export function WorkPackageStatus({ status }: { status: OpenProjectStatus }) {
  const safeStatusColor = safeColor(status.color);

  return (
    <span>
      <WorkPackageStatusIndicator
        {...(safeStatusColor ? { style: { background: safeStatusColor } } : {})}
      />
      {status.name}
    </span>
  );
}
