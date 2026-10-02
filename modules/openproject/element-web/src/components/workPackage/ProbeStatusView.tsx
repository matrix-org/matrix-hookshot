import * as React from "react";
import { Button } from "@vector-im/compound-web";
import type { AnchorProbeState } from "../../viewmodels/workPackage/AnchorMessageViewModel";
import styles from "./WorkPackage.module.css";

export function ProbeStatusView({
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

  if (state.kind === "disabled") {
    return null;
  }

  return (
    <div aria-live="polite" className={styles.probeStatus}>
      OpenProject actions unavailable{" "}
      <Button kind="secondary" size="md" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
