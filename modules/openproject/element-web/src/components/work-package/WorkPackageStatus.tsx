import * as React from "react";
import type { OpenProjectStatus } from "./types";
import { safeColor } from "./validation";
import { WorkPackageStatusIndicator } from "./WorkPackageStyles";

export function WorkPackageStatus({ status }: { status: OpenProjectStatus }) {
  return (
    <span>
      <WorkPackageStatusIndicator
        style={{ background: safeColor(status.color) }}
      />
      {status.name}
    </span>
  );
}
