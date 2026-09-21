import * as React from "react";
import type { OpenProjectWorkPackageContent } from "../models/OpenProjectMatrixEventContent";
import { WorkPackageLink } from "./WorkPackageLink";

export function WorkPackageHeader({
  workPackage,
  action,
}: {
  workPackage: OpenProjectWorkPackageContent;
  action: "created" | "updated";
}) {
  return (
    <span>
      Work package{" "}
      <WorkPackageLink url={workPackage.url}>{workPackage.id}</WorkPackageLink>{" "}
      {action}
      {action === "created" ? ` by ${workPackage.author.name}` : null}
    </span>
  );
}
