import * as React from "react";
import { IconButton } from "@vector-im/compound-web";
import LinkIcon from "@vector-im/compound-design-tokens/assets/web/icons/link";
import { useViewModel } from "@element-hq/web-shared-components";
import { safeHtml } from "../../utils/validation";
import type { ActivityViewModel } from "../../viewmodels/workPackage/ActivityMessageViewModel";
import { LinkView } from "./LinkView";
import styles from "./WorkPackage.module.css";

interface ActivityViewProps {
  readonly vm: ActivityViewModel;
}

export function ActivityView({ vm }: Readonly<ActivityViewProps>) {
  const snapshot = useViewModel(vm);
  if (!snapshot) {
    return null;
  }

  const { workPackage, changeSummary, actor } = snapshot;
  const safeChangeSummary = safeHtml(changeSummary);

  return (
    <div className={styles.activity}>
      <div className={styles.activityContent}>
        <LinkView
          url={workPackage.url}
          title={`#${workPackage.id} ${workPackage.subject}`}
        >
          #{workPackage.id}
        </LinkView>
        {" - "}
        <LinkView url={actor?.url}>{actor?.name ?? "Someone"}</LinkView>{" "}
        {safeChangeSummary ? (
          <span dangerouslySetInnerHTML={{ __html: safeChangeSummary }} />
        ) : (
          changeSummary
        )}
      </div>
      {vm.onViewTimelineCard && (
        <div className={styles.activityAction}>
          <IconButton
            aria-label="View timeline card"
            kind="secondary"
            size="20px"
            title="View timeline card"
            onClick={vm.onViewTimelineCard}
          >
            <LinkIcon />
          </IconButton>
        </div>
      )}
    </div>
  );
}
