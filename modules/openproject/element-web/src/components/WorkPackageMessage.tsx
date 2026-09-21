import * as React from "react";
import type { OpenProjectContent } from "../models/OpenProjectMatrixEventContent";
import {
  createCreatedWorkPackageMessageViewModel,
  createUpdatedWorkPackageMessageViewModel,
  type WorkPackageCreatedMessageViewModel,
  type WorkPackageUpdatedMessageViewModel,
} from "../viewmodels/WorkPackageMessageViewModel";
import { WorkPackageActions } from "./WorkPackageActions";
import { WorkPackageChangedDetails } from "./WorkPackageChangedDetails";
import { WorkPackageDescription } from "./WorkPackageDescription";
import { WorkPackageHeader } from "./WorkPackageHeader";
import { WorkPackageLayout } from "./WorkPackageLayout";
import { WorkPackageMetadata } from "./WorkPackageMetadata";
import { WorkPackageTitle } from "./WorkPackageTitle";
import { WorkPackageMessage } from "./WorkPackageStyles";

export type { OpenProjectContent } from "../models/OpenProjectMatrixEventContent";

function WorkPackageUpdatedMessageView({
  viewModel,
}: {
  viewModel: WorkPackageUpdatedMessageViewModel;
}) {
  return (
    <WorkPackageMessage>
      <WorkPackageHeader
        workPackage={viewModel.workPackage}
        header={viewModel.header}
      />
      <WorkPackageLayout borderColor={viewModel.workPackage.type.color}>
        <WorkPackageTitle workPackage={viewModel.workPackage} />
        {viewModel.changedDetail ? (
          <WorkPackageChangedDetails
            detail={viewModel.changedDetail}
            descriptionAsDetails
          />
        ) : null}
      </WorkPackageLayout>
    </WorkPackageMessage>
  );
}

function WorkPackageCreatedMessageView({
  viewModel,
}: {
  viewModel: WorkPackageCreatedMessageViewModel;
}) {
  return (
    <WorkPackageMessage>
      <WorkPackageHeader
        workPackage={viewModel.workPackage}
        header={viewModel.header}
      />
      <WorkPackageLayout borderColor={viewModel.workPackage.type.color}>
        <WorkPackageTitle workPackage={viewModel.workPackage} />
        <WorkPackageDescription
          description={viewModel.workPackage.description}
        />
        <WorkPackageMetadata workPackage={viewModel.workPackage} />
        <WorkPackageActions url={viewModel.workPackage.url} />
      </WorkPackageLayout>
    </WorkPackageMessage>
  );
}

export function WorkPackageUpdatedMessage({
  data,
}: {
  data: OpenProjectContent;
}) {
  const viewModel = createUpdatedWorkPackageMessageViewModel(data);
  return viewModel ? (
    <WorkPackageUpdatedMessageView viewModel={viewModel} />
  ) : null;
}

export function WorkPackageCreatedMessage({
  data,
}: {
  data: OpenProjectContent;
}) {
  const viewModel = createCreatedWorkPackageMessageViewModel(data);
  return viewModel ? (
    <WorkPackageCreatedMessageView viewModel={viewModel} />
  ) : null;
}
