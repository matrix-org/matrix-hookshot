import * as React from "react";
import type { OpenProjectWorkPackageContent } from "./types";
import { safeUrl } from "./validation";
import { WorkPackageTitleLink } from "./WorkPackageStyles";

export function WorkPackageTitle({
  workPackage,
}: {
  workPackage: OpenProjectWorkPackageContent;
}) {
  return (
    <WorkPackageTitleLink href={safeUrl(workPackage.url)}>
      #{workPackage.id} {workPackage.subject}
    </WorkPackageTitleLink>
  );
}
