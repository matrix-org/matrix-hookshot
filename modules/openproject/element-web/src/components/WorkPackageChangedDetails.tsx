import * as React from "react";
import type { WorkPackageChangedDetailViewModel } from "../viewmodels/WorkPackageMessageViewModel";
import { WorkPackageDescription } from "./WorkPackageDescription";
import { WorkPackageChangedText } from "./WorkPackageStyles";
import { WorkPackageStatus } from "./WorkPackageStatus";

export function WorkPackageChangedDetails({
  detail,
  descriptionAsDetails = false,
}: {
  detail: WorkPackageChangedDetailViewModel;
  descriptionAsDetails?: boolean;
}) {
  switch (detail.kind) {
    case "assignee":
      return (
        <WorkPackageChangedText>
          Assignee changed to <strong>{detail.currentName}</strong>
        </WorkPackageChangedText>
      );
    case "description":
      if (descriptionAsDetails) {
        return (
          <WorkPackageChangedText>
            <details>
              <summary>Description changed</summary>
              <WorkPackageDescription description={detail.description} />
            </details>
          </WorkPackageChangedText>
        );
      }
      return (
        <WorkPackageChangedText>
          <span>Description changed</span>
          <WorkPackageDescription description={detail.description} />
        </WorkPackageChangedText>
      );
    case "dueDate":
      return (
        <WorkPackageChangedText>
          {detail.currentValue === null
            ? "Due date removed"
            : [
                "Due date changed to ",
                <strong key="due-date">{detail.currentValue}</strong>,
              ]}
        </WorkPackageChangedText>
      );
    case "percentageDone":
      return (
        <WorkPackageChangedText>
          {detail.currentValue === null
            ? "Work completion percentage removed"
            : [
                "Work package is now ",
                <strong key="percentage-done">{detail.currentValue}</strong>,
                "% complete",
              ]}
        </WorkPackageChangedText>
      );
    case "priority":
      return (
        <WorkPackageChangedText>
          Priority changed from <strong>{detail.previousName}</strong> to{" "}
          <strong>{detail.currentName}</strong>
        </WorkPackageChangedText>
      );
    case "responsible":
      return (
        <WorkPackageChangedText>
          Updated accountable person to <strong>{detail.currentName}</strong>
        </WorkPackageChangedText>
      );
    case "status":
      return (
        <WorkPackageChangedText>
          Status changed from <WorkPackageStatus status={detail.previous} /> to{" "}
          <WorkPackageStatus status={detail.current} />
        </WorkPackageChangedText>
      );
    case "subject":
      return <WorkPackageChangedText>Subject changed</WorkPackageChangedText>;
    case "type":
      return (
        <WorkPackageChangedText>
          Type changed to <strong>{detail.currentName}</strong>
        </WorkPackageChangedText>
      );
  }
}
