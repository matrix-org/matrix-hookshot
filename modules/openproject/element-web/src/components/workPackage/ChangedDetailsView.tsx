import * as React from "react";
import type { ChangeSnapshot } from "../../viewmodels/workPackage/ChangeSnapshot";
import { DescriptionView } from "./DescriptionView";
import { StatusView } from "./StatusView";
import styles from "./WorkPackage.module.css";

export function ChangedDetailsView({
  change,
  descriptionAsDetails = false,
}: {
  change: ChangeSnapshot;
  descriptionAsDetails?: boolean;
}) {
  switch (change.kind) {
    case "assignee":
      return (
        <div className={styles.changedDetailsText}>
          Assignee changed to <strong>{change.currentName}</strong>
        </div>
      );
    case "description":
      if (descriptionAsDetails) {
        return (
          <div className={styles.changedDetailsText}>
            <details>
              <summary>Description changed</summary>
              <DescriptionView {...change.description} />
            </details>
          </div>
        );
      }
      return (
        <div className={styles.changedDetailsText}>
          <span>Description changed</span>
          <DescriptionView {...change.description} />
        </div>
      );
    case "dueDate":
      return (
        <div className={styles.changedDetailsText}>
          {change.currentValue === null
            ? "Due date removed"
            : [
                "Due date changed to ",
                <strong key="due-date">{change.currentValue}</strong>,
              ]}
        </div>
      );
    case "percentageDone":
      return (
        <div className={styles.changedDetailsText}>
          {change.currentValue === null
            ? "Work completion percentage removed"
            : [
                "Work package is now ",
                <strong key="percentage-done">{change.currentValue}</strong>,
                "% complete",
              ]}
        </div>
      );
    case "priority":
      return (
        <div className={styles.changedDetailsText}>
          Priority changed from <strong>{change.previousName}</strong> to{" "}
          <strong>{change.currentName}</strong>
        </div>
      );
    case "responsible":
      return (
        <div className={styles.changedDetailsText}>
          Updated accountable person to <strong>{change.currentName}</strong>
        </div>
      );
    case "status":
      return (
        <div className={styles.changedDetailsText}>
          Status changed from <StatusView {...change.previous} /> to{" "}
          <StatusView {...change.current} />
        </div>
      );
    case "subject":
      return <div className={styles.changedDetailsText}>Subject changed</div>;
    case "type":
      return (
        <div className={styles.changedDetailsText}>
          Type changed to <strong>{change.currentName}</strong>
        </div>
      );
  }
}
