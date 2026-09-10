import * as React from "react";
import type {
  OpenProjectWorkPackageChanges,
  OpenProjectWorkPackageContent,
} from "./types";
import { WorkPackageDescription } from "./WorkPackageDescription";
import { WorkPackageChangedText } from "./WorkPackageStyles";
import { WorkPackageStatus } from "./WorkPackageStatus";

export function WorkPackageChangedDetails({
  workPackage,
  changes,
  descriptionAsDetails = false,
}: {
  workPackage: OpenProjectWorkPackageContent;
  changes: OpenProjectWorkPackageChanges;
  descriptionAsDetails?: boolean;
}) {
  let innerContent = null;
  if (changes.assignee !== undefined) {
    innerContent = (
      <WorkPackageChangedText>
        Assignee changed to{" "}
        <strong>{workPackage.assignee?.name ?? "Nobody"}</strong>
      </WorkPackageChangedText>
    );
  } else if (changes.description !== undefined) {
    innerContent = (
      <WorkPackageChangedText>
        <span>Description changed</span>
        <WorkPackageDescription
          description={workPackage.description}
          asDetails={descriptionAsDetails}
        />
      </WorkPackageChangedText>
    );
  } else if (changes.dueDate !== undefined) {
    innerContent = (
      <WorkPackageChangedText>
        {workPackage.dueDate === null
          ? "Due date removed"
          : [
              "Due date changed to ",
              <strong key="due-date">{workPackage.dueDate}</strong>,
            ]}
      </WorkPackageChangedText>
    );
  } else if (changes.percentageDone !== undefined) {
    innerContent = (
      <WorkPackageChangedText>
        {workPackage.percentageDone === null
          ? "Work completion percentage removed"
          : [
              "Work package is now ",
              <strong key="percentage-done">
                {workPackage.percentageDone}
              </strong>,
              "% complete",
            ]}
      </WorkPackageChangedText>
    );
  } else if (changes.priority !== undefined) {
    innerContent = (
      <WorkPackageChangedText>
        Priority changed from{" "}
        <strong>{changes.priority?.name ?? "None"}</strong> to{" "}
        <strong>{workPackage.priority?.name ?? "None"}</strong>
      </WorkPackageChangedText>
    );
  } else if (changes.responsible !== undefined) {
    innerContent = (
      <WorkPackageChangedText>
        Updated accountable person to{" "}
        <strong>{workPackage.responsible?.name ?? "Nobody"}</strong>
      </WorkPackageChangedText>
    );
  } else if (changes.status !== undefined) {
    innerContent = (
      <WorkPackageChangedText>
        Status changed from <WorkPackageStatus status={changes.status} /> to{" "}
        <WorkPackageStatus status={workPackage.status} />
      </WorkPackageChangedText>
    );
  } else if (changes.subject !== undefined) {
    innerContent = (
      <WorkPackageChangedText>Subject changed</WorkPackageChangedText>
    );
  } else if (changes.type !== undefined) {
    innerContent = (
      <WorkPackageChangedText>
        Type changed to <strong>{workPackage.type.name}</strong>
      </WorkPackageChangedText>
    );
  }

  return innerContent;
}
