import * as React from "react";
import { LinkView } from "./LinkView";
import { StatusView } from "./StatusView";
import styles from "./WorkPackage.module.css";

export function MetadataView({
  statusName,
  statusColor,
  typeName,
  assigneeName,
  authorName,
  authorUrl,
}: {
  statusName: string;
  statusColor?: string;
  typeName: string;
  assigneeName?: string;
  authorName: string;
  authorUrl?: string;
}) {
  return (
    <div className={styles.metadataRow}>
      <StatusView name={statusName} color={statusColor} />
      <span>{typeName}</span>
      {assigneeName ? <span>Assigned to {assigneeName}</span> : null}
      <span>
        Created by <LinkView url={authorUrl}>{authorName}</LinkView>
      </span>
    </div>
  );
}
