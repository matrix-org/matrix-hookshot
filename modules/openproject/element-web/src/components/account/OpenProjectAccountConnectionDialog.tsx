import * as React from "react";
import type {
  Api,
  DialogHandle,
  DialogProps,
} from "@element-hq/element-web-module-api";
import { Button } from "@vector-im/compound-web";
import type { OpenProjectAnchor } from "../../capabilities/OpenProjectCapabilityClient";
import type { ProfileIdentity } from "../../capabilities/OpenProjectProfile";
import {
  OpenProjectAccountConnectionViewModel,
  type OpenProjectAccountConnectionState,
  type OpenProjectLoginClient,
} from "../../viewmodels/accountConnection/OpenProjectAccountConnectionViewModel";
import styles from "./OpenProjectAccountConnectionDialog.module.css";

export interface OpenProjectAccountConnectionDialogProps {
  readonly client: OpenProjectLoginClient;
  readonly anchor: OpenProjectAnchor;
  readonly baseUrl?: URL;
}

export interface OpenProjectAccountConnectionDialogResult {
  readonly sessionIdentity: ProfileIdentity;
}

interface OpenProjectAccountConnectionDialogBodyProps
  extends
    OpenProjectAccountConnectionDialogProps,
    DialogProps<OpenProjectAccountConnectionDialogResult> {}

/** Opens the account connection flow using Element's dialog host. */
export function openOpenProjectAccountConnectionDialog(
  api: Pick<Api, "openDialog">,
  props: OpenProjectAccountConnectionDialogProps,
): DialogHandle<OpenProjectAccountConnectionDialogResult> {
  return api.openDialog(
    { title: "Connect your OpenProject account" },
    OpenProjectAccountConnectionDialog,
    props,
  );
}

/** Dialog body rendered by Element's dialog host. */
export function OpenProjectAccountConnectionDialog({
  client,
  anchor,
  baseUrl,
  onSubmit,
}: OpenProjectAccountConnectionDialogBodyProps) {
  const lifecycle = React.useRef({ generation: 0, mounted: false });
  const viewModel = React.useMemo(
    () =>
      new OpenProjectAccountConnectionViewModel(
        client,
        anchor,
        baseUrl,
        (sessionIdentity) => {
          if (lifecycle.current.mounted) {
            onSubmit({ sessionIdentity });
          }
        },
      ),
    [client, anchor, baseUrl, onSubmit],
  );
  const state = React.useSyncExternalStore(
    React.useCallback((listener) => viewModel.subscribe(listener), [viewModel]),
    () => viewModel.getSnapshot(),
    () => viewModel.getSnapshot(),
  );
  React.useEffect(() => {
    const generation = ++lifecycle.current.generation;
    lifecycle.current.mounted = true;
    viewModel.start();
    return () => {
      lifecycle.current.mounted = false;
      queueMicrotask(() => {
        if (
          lifecycle.current.generation === generation &&
          !lifecycle.current.mounted
        ) {
          viewModel.dispose();
        }
      });
    };
  }, [viewModel]);

  return (
    <OpenProjectAccountConnectionDialogView
      state={state}
      onLinkClick={viewModel.beginAuthorizationCheck}
      onRetry={viewModel.retry}
    />
  );
}

export interface OpenProjectAccountConnectionDialogViewProps {
  readonly state: OpenProjectAccountConnectionState;
  readonly onLinkClick: () => void;
  readonly onRetry: () => void;
}

/** Renders the dialog state for live use and static Storybook examples. */
export function OpenProjectAccountConnectionDialogView({
  state,
  onLinkClick,
  onRetry,
}: OpenProjectAccountConnectionDialogViewProps) {
  const hasFooterAction =
    state.kind === "ready" ||
    state.kind === "polling" ||
    state.kind === "denied" ||
    state.kind === "unavailable" ||
    state.kind === "expired";

  return (
    <section className={styles.card}>
      <div className={styles.detailsRow}>
        <header className={styles.header}>
          <span role="status" aria-live="polite">
            {stateMessage(state)}
          </span>
        </header>
      </div>

      <footer className={styles.actionsRow}>
        {state.kind === "ready" && (
          <Button
            as="a"
            href={state.authorizationUrl}
            target="_blank"
            rel="noopener noreferrer"
            size="md"
            kind="primary"
            onClick={onLinkClick}
          >
            Link account
          </Button>
        )}

        {state.kind === "polling" && (
          <Button
            as="a"
            href={state.authorizationUrl}
            target="_blank"
            rel="noopener noreferrer"
            size="md"
            kind="secondary"
            onClick={onLinkClick}
          >
            Open sign-in again
          </Button>
        )}

        {(state.kind === "denied" ||
          state.kind === "unavailable" ||
          state.kind === "expired") && (
          <Button size="md" kind="secondary" onClick={onRetry}>
            Try again
          </Button>
        )}

        {!hasFooterAction && (
          <Button size="md" kind="primary" disabled>
            Link account
          </Button>
        )}
      </footer>
    </section>
  );
}

function stateMessage(state: OpenProjectAccountConnectionState): string {
  switch (state.kind) {
    case "starting":
      return "Preparing an OpenProject sign-in link…";
    case "ready":
      return "Continue to OpenProject to authorize your account. This opens in a new tab.";
    case "polling":
      return "Waiting for OpenProject to finish authorization…";
    case "connected":
      return "Your OpenProject account is connected. Package access is checked separately.";
    case "denied":
      return "You are not allowed to connect an OpenProject account. Contact your Hookshot administrator.";
    case "unavailable":
      return "Hookshot could not complete the account connection. Try again or close this dialog.";
    case "configuration_error":
      return "Hookshot is misconfigured. Contact your Hookshot administrator.";
    case "expired":
      return "The sign-in check expired before Hookshot confirmed the connection. Try again.";
    case "session_changed":
      return "Your Matrix account or device changed. Close this dialog and start again.";
    case "cancelled":
      return "Account connection cancelled.";
  }
}
