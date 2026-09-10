import * as React from "react";
import type {
  OpenProjectContent,
  OpenProjectWorkPackageContent,
} from "./types";
import { WorkPackageActions } from "./WorkPackageActions";
import { WorkPackageChangedDetails } from "./WorkPackageChangedDetails";
import { WorkPackageDescription } from "./WorkPackageDescription";
import { WorkPackageLayout } from "./WorkPackageLayout";
import { WorkPackageLink } from "./WorkPackageLink";
import { WorkPackageMetadata } from "./WorkPackageMetadata";
import { WorkPackageTitle } from "./WorkPackageTitle";

export type { OpenProjectContent } from "./types";

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

export function WorkPackageUpdatedMessage({
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
          descriptionAsDetails
        />
      </WorkPackageLayout>
    </div>
  );
}

export function WorkPackageCreatedMessage({
  data,
}: {
  data: OpenProjectContent;
}) {
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
