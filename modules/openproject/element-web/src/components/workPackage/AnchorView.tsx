import * as React from "react";
import { useViewModel } from "@element-hq/web-shared-components";
import type { AnchorViewModel } from "../../viewmodels/workPackage/AnchorMessageViewModel";
import { ActionsView } from "./ActionsView";
import { HeaderView } from "./HeaderView";
import { MetadataView } from "./MetadataView";
import { ProbeStatusView } from "./ProbeStatusView";
import { TitleView } from "./TitleView";
import styles from "./WorkPackage.module.css";

export function AnchorView({ vm }: { vm: AnchorViewModel }) {
  const snapshot = useViewModel(vm);
  if (!snapshot) {
    return null;
  }

  const { details, anchor } = snapshot;

  if (anchor?.state === "inactive") {
    return (
      <div className={styles.card}>
        <div className={styles.detailsRow}>
          <HeaderView
            id={details.id}
            url={details.url}
            project={details.project}
            action={anchor.state}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <div className={styles.detailsRow}>
        <HeaderView
          id={details.id}
          url={details.url}
          project={details.project}
          isClosed={details.status.isClosed}
          action={anchor.state}
        />
        <TitleView subject={details.subject} />
        <MetadataView
          statusName={details.status.name}
          isClosed={details.status.isClosed}
          typeName={details.type.name}
          assigneeName={details.assignee?.name}
          deadlineLabel={details.deadline?.label}
          deadlineDate={details.deadline?.date}
        />
      </div>
      <div className={styles.actionsRow}>
        <ActionsView url={details.url} />
        <ProbeStatusView state={snapshot.probe} onRetry={vm.retry} />
      </div>
    </div>
  );
}
