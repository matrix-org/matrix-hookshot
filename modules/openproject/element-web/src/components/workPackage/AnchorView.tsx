import * as React from "react";
import { useViewModel } from "@element-hq/web-shared-components";
import { Button } from "@vector-im/compound-web";
import type {
  AnchorProbeState,
  AnchorViewModel,
} from "../../viewmodels/workPackage/AnchorMessageViewModel";
import { ActionsView } from "./ActionsView";
import { DescriptionView } from "./DescriptionView";
import { HeaderView } from "./HeaderView";
import { LayoutView } from "./LayoutView";
import { MetadataView } from "./MetadataView";
import { TitleView } from "./TitleView";
import styles from "./WorkPackage.module.css";

function ProbeStatus({
  state,
  onRetry,
}: {
  state: AnchorProbeState;
  onRetry: () => void;
}) {
  if (state.kind === "loading") {
    return <span aria-live="polite">Checking OpenProject actions…</span>;
  }

  if (state.kind === "result" && state.result === "ok") {
    return <span aria-live="polite">OpenProject connection verified</span>;
  }

  if (state.kind === "result" && state.result === "not_connected") {
    return <span aria-live="polite">OpenProject account not connected</span>;
  }

  return (
    <span aria-live="polite" className={styles.probeStatus}>
      OpenProject actions unavailable{" "}
      <Button kind="secondary" size="md" onClick={onRetry}>
        Retry
      </Button>
    </span>
  );
}

export function AnchorView({ vm }: { vm: AnchorViewModel }) {
  const snapshot = useViewModel(vm);
  if (!snapshot) {
    return null;
  }

  const { details, header } = snapshot;

  return (
    <div>
      <HeaderView
        id={details.id}
        url={details.url}
        action={header.action}
        authorName={header.authorName}
      />
      <LayoutView borderColor={details.type.color}>
        <TitleView
          id={details.id}
          subject={details.subject}
          url={details.url}
        />
        <DescriptionView {...details.description} />
        <MetadataView
          statusName={details.status.name}
          statusColor={details.status.color}
          typeName={details.type.name}
          assigneeName={details.assignee?.name}
          authorName={details.author.name}
          authorUrl={details.author.url}
        />
        <div className={styles.actionsRow}>
          <ActionsView url={details.url} />
          <ProbeStatus state={snapshot.probe} onRetry={vm.retry} />
        </div>
      </LayoutView>
    </div>
  );
}
