import * as React from "react";
import type { OpenProjectWorkPackageContent } from "./types";
import { WorkPackageLink } from "./WorkPackageLink";
import { WorkPackageRow } from "./WorkPackageStyles";
import { WorkPackageStatus } from "./WorkPackageStatus";

export function WorkPackageMetadata({
  workPackage,
}: {
  workPackage: OpenProjectWorkPackageContent;
}) {
  return (
    <WorkPackageRow>
      <WorkPackageStatus status={workPackage.status} />
      <span>{workPackage.type.name}</span>
      {workPackage.assignee?.name ? (
        <span>Assigned to {workPackage.assignee.name}</span>
      ) : null}
      <span>
        Created by{" "}
        <WorkPackageLink url={workPackage.author.url}>
          {workPackage.author.name}
        </WorkPackageLink>
      </span>
    </WorkPackageRow>
  );
}
