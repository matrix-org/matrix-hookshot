import * as React from "react";
import type {
  WorkPackageHeaderViewModel,
  WorkPackageViewModel,
} from "../viewmodels/WorkPackageMessageViewModel";
import { WorkPackageLink } from "./WorkPackageLink";

export function WorkPackageHeader({
  workPackage,
  header,
}: {
  workPackage: WorkPackageViewModel;
  header: WorkPackageHeaderViewModel;
}) {
  return (
    <span>
      Work package{" "}
      <WorkPackageLink url={workPackage.url}>{workPackage.id}</WorkPackageLink>{" "}
      {header.action}
      {header.authorName ? ` by ${header.authorName}` : null}
    </span>
  );
}
