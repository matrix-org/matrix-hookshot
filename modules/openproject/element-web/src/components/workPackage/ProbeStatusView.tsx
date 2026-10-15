import * as React from "react";
import { IconButton } from "@vector-im/compound-web";
import {
  CheckCircleIcon,
  SpinnerIcon,
  InfoIcon,
  RestartIcon,
} from "@vector-im/compound-design-tokens/assets/web/icons";
import type { AnchorProbeState } from "../../viewmodels/workPackage/AnchorMessageViewModel";
import styles from "./WorkPackage.module.css";

export function ProbeStatusView({
  state,
  onRetry,
}: {
  state: AnchorProbeState;
  onRetry: () => void;
}) {
  if (state.kind === "disabled") {
    return null;
  }

  if (state.kind === "loading") {
    return (
      <div aria-live="polite">
        <IconButton
          aria-label="Checking OpenProject connection..."
          tooltip="Checking OpenProject connection..."
          className={styles.statusIconButton}
          disabled
          noBackground
        >
          <SpinnerIcon className={styles.spinner} />
        </IconButton>
      </div>
    );
  }

  if (state.kind === "result" && state.result === "ok") {
    return (
      <div aria-live="polite">
        <IconButton
          aria-label="OpenProject connection verified."
          tooltip="OpenProject connection verified."
          className={styles.statusIconButton}
          disabled
          noBackground
        >
          <CheckCircleIcon />
        </IconButton>
      </div>
    );
  }

  if (state.kind === "result" && state.result === "not_connected") {
    return (
      <div aria-live="polite">
        <IconButton
          aria-label="OpenProject account not connected."
          tooltip="OpenProject account not connected."
          className={styles.statusIconButton}
          disabled
          noBackground
        >
          <InfoIcon />
        </IconButton>
      </div>
    );
  }

  if (state.kind === "result" && state.result === "not_authorized") {
    return (
      <div aria-live="polite">
        <IconButton
          destructive
          aria-label="OpenProject account not authorized. Click to retry."
          tooltip="OpenProject account not authorized. Click to retry."
          onClick={onRetry}
        >
          <RestartIcon />
        </IconButton>
      </div>
    );
  }

  return (
    <div aria-live="polite">
      <IconButton
        destructive
        aria-label="OpenProject connection unavailable. Click to retry."
        tooltip="OpenProject connection unavailable. Click to retry."
        onClick={onRetry}
      >
        <RestartIcon />
      </IconButton>
    </div>
  );
}
