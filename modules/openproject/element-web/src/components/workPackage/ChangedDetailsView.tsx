import * as React from "react";
import type { ChangeViewModel } from "../../viewmodels/workPackage/ChangeViewModel";
import { DescriptionView } from "./DescriptionView";
import { StatusView } from "./StatusView";
import { WorkPackageChangedText } from "./styles";

export function ChangedDetailsView({
  change,
  descriptionAsDetails = false,
}: {
  change: ChangeViewModel;
  descriptionAsDetails?: boolean;
}) {
  switch (change.kind) {
    case "assignee":
      return (
        <WorkPackageChangedText>
          Assignee changed to <strong>{change.currentName}</strong>
        </WorkPackageChangedText>
      );
    case "description":
      if (descriptionAsDetails) {
        return (
          <WorkPackageChangedText>
            <details>
              <summary>Description changed</summary>
              <DescriptionView {...change.description} />
            </details>
          </WorkPackageChangedText>
        );
      }
      return (
        <WorkPackageChangedText>
          <span>Description changed</span>
          <DescriptionView {...change.description} />
        </WorkPackageChangedText>
      );
    case "dueDate":
      return (
        <WorkPackageChangedText>
          {change.currentValue === null
            ? "Due date removed"
            : [
                "Due date changed to ",
                <strong key="due-date">{change.currentValue}</strong>,
              ]}
        </WorkPackageChangedText>
      );
    case "percentageDone":
      return (
        <WorkPackageChangedText>
          {change.currentValue === null
            ? "Work completion percentage removed"
            : [
                "Work package is now ",
                <strong key="percentage-done">{change.currentValue}</strong>,
                "% complete",
              ]}
        </WorkPackageChangedText>
      );
    case "priority":
      return (
        <WorkPackageChangedText>
          Priority changed from <strong>{change.previousName}</strong> to{" "}
          <strong>{change.currentName}</strong>
        </WorkPackageChangedText>
      );
    case "responsible":
      return (
        <WorkPackageChangedText>
          Updated accountable person to <strong>{change.currentName}</strong>
        </WorkPackageChangedText>
      );
    case "status":
      return (
        <WorkPackageChangedText>
          Status changed from <StatusView {...change.previous} /> to{" "}
          <StatusView {...change.current} />
        </WorkPackageChangedText>
      );
    case "subject":
      return <WorkPackageChangedText>Subject changed</WorkPackageChangedText>;
    case "type":
      return (
        <WorkPackageChangedText>
          Type changed to <strong>{change.currentName}</strong>
        </WorkPackageChangedText>
      );
  }
}
