import * as React from "react";
import type { OpenProjectContent } from "./types";
import { WorkPackageActions } from "./WorkPackageActions";
import { WorkPackageChangedDetails } from "./WorkPackageChangedDetails";
import { WorkPackageDescription } from "./WorkPackageDescription";
import { WorkPackageHeader } from "./WorkPackageHeader";
import { WorkPackageLayout } from "./WorkPackageLayout";
import { WorkPackageMetadata } from "./WorkPackageMetadata";
import { WorkPackageTitle } from "./WorkPackageTitle";
import { WorkPackageMessage } from "./WorkPackageStyles";

export type { OpenProjectContent } from "./types";

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
    <WorkPackageMessage>
      <WorkPackageHeader workPackage={workPackage} action="updated" />
      <WorkPackageLayout borderColor={workPackage.type.color}>
        <WorkPackageTitle workPackage={workPackage} />
        <WorkPackageChangedDetails
          workPackage={workPackage}
          changes={changes}
          descriptionAsDetails
        />
      </WorkPackageLayout>
    </WorkPackageMessage>
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
    <WorkPackageMessage>
      <WorkPackageHeader workPackage={workPackage} action="created" />
      <WorkPackageLayout borderColor={workPackage.type.color}>
        <WorkPackageTitle workPackage={workPackage} />
        <WorkPackageDescription description={workPackage.description} />
        <WorkPackageMetadata workPackage={workPackage} />
        <WorkPackageActions url={workPackage.url} />
      </WorkPackageLayout>
    </WorkPackageMessage>
  );
}
