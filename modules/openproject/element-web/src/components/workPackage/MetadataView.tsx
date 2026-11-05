import * as React from "react";
import { Badge } from "@vector-im/compound-web";
import styles from "./WorkPackage.module.css";

export function MetadataView({
  statusName,
  typeName,
  assigneeName,
  isClosed,
  deadlineLabel,
  deadlineDate,
}: {
  statusName: string;
  typeName: string;
  assigneeName?: string;
  isClosed?: boolean;
  deadlineLabel?: string;
  deadlineDate?: string;
}) {
  const assignee = assigneeName ? `Assigned to ${assigneeName}` : "Unassigned";

  return (
    <div className={styles.metadataRow}>
      <Badge kind={isClosed ? "grey" : "blue"} className={styles.metadataText}>
        {statusName}
      </Badge>
      <Badge kind="grey" className={styles.metadataText}>
        {typeName}
      </Badge>
      {assignee ? (
        <Badge kind="grey" className={styles.metadataText}>
          {assignee}
        </Badge>
      ) : null}
      {deadlineDate !== undefined ? (
        <Badge kind="grey" className={styles.metadataText}>
          {deadlineLabel ? `${deadlineLabel} ` : null}
          {deadlineDate}
        </Badge>
      ) : null}
    </div>
  );
}
