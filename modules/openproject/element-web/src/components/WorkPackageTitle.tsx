import * as React from "react";
import type { OpenProjectWorkPackageContent } from "./types";
import { safeUrl } from "./validation";
import { WorkPackageTitleLink } from "./WorkPackageStyles";

export function WorkPackageTitle({
  workPackage,
}: {
  workPackage: OpenProjectWorkPackageContent;
  }) {
  const refLink = safeUrl(workPackage.url);
  
  if (refLink){
    return (
      <WorkPackageTitleLink href={refLink}>
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
