import * as React from "react";
import { IconButton } from "@vector-im/compound-web";
import LinkIcon from "@vector-im/compound-design-tokens/assets/web/icons/link";
import { useViewModel } from "@element-hq/web-shared-components";
import { safeHtml } from "../../utils/validation";
import type { ActivityViewModel } from "../../viewmodels/workPackage/ActivityMessageViewModel";
import styles from "./WorkPackage.module.css";

interface ActivityViewProps {
  readonly vm: ActivityViewModel;
}

export function ActivityView({ vm }: Readonly<ActivityViewProps>) {
  const { changeSummary } = useViewModel(vm);
  const safeChangeSummary = safeHtml(changeSummary);

  if (!safeChangeSummary) {
    return null;
  }

  return (
    <div className={styles.activity}>
      <div className={styles.activityContent}>
        <span dangerouslySetInnerHTML={{ __html: safeChangeSummary }} />
      </div>
      {vm.onViewTimelineCard && (
        <div className={styles.activityAction}>
          <IconButton
            aria-label="View timeline card"
            kind="primary"
            size="20px"
            noBackground
            tooltip="View timeline card"
            onClick={vm.onViewTimelineCard}
          >
            <LinkIcon />
          </IconButton>
        </div>
      )}
    </div>
  );
}
