import * as React from "react";
import type {
  OpenProjectContent,
  OpenProjectWorkPackageContent,
} from "./work-package/types";
import { WorkPackageActions } from "./work-package/WorkPackageActions";
import { WorkPackageChangedDetails } from "./work-package/WorkPackageChangedDetails";
import { WorkPackageDescription } from "./work-package/WorkPackageDescription";
import { WorkPackageLayout } from "./work-package/WorkPackageLayout";
import { WorkPackageLink } from "./work-package/WorkPackageLink";
import { WorkPackageMetadata } from "./work-package/WorkPackageMetadata";
import { WorkPackageTitle } from "./work-package/WorkPackageTitle";

export type { OpenProjectContent } from "./work-package/types";

function WorkPackageHeader({
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

export function OpenProjectEventWidgetChanged({
  data,
}: {
  data: OpenProjectContent;
}) {
  const workPackage =
    data["org.matrix.matrix-hookshot.openproject.work_package"];
  const changes =
    data["org.matrix.matrix-hookshot.openproject.work_package.changed"];
  if (!workPackage || !changes) {
    return null;
  }

  return (
    <div>
      <WorkPackageHeader workPackage={workPackage} action="updated" />
      <WorkPackageLayout borderColor={workPackage.type.color}>
        <WorkPackageTitle workPackage={workPackage} />
        <WorkPackageChangedDetails
          workPackage={workPackage}
          changes={changes}
        />
      </WorkPackageLayout>
    </div>
  );
}

export function OpenProjectEventWidget({ data }: { data: OpenProjectContent }) {
  const workPackage =
    data["org.matrix.matrix-hookshot.openproject.work_package"];
  if (!workPackage) {
    return null;
  }

  return (
    <div>
      <WorkPackageHeader workPackage={workPackage} action="created" />
      <WorkPackageLayout borderColor={workPackage.type.color}>
        <WorkPackageTitle workPackage={workPackage} />
        <WorkPackageDescription description={workPackage.description} />
        <WorkPackageMetadata workPackage={workPackage} />
        <WorkPackageActions url={workPackage.url} />
      </WorkPackageLayout>
    </div>
  );
}
