import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  OpenProjectAccountConnectionDialogView,
  type OpenProjectAccountConnectionDialogViewProps,
} from "./OpenProjectAccountConnectionDialog";
import styles from "./OpenProjectAccountConnectionDialog.stories.module.css";

const exampleAuthorizationUrl =
  "https://projects.example.org/oauth/authorize?client_id=storybook-example&state=example-state";

const meta = {
  title: "OpenProject/Account/Dialog",
  component: OpenProjectAccountConnectionDialogView,
  tags: ["autodocs"],
} satisfies Meta<typeof OpenProjectAccountConnectionDialogView>;

export default meta;
type Story = StoryObj;

const actions = {
  onLinkClick: () => {},
  onRetry: () => {},
};

function renderState(
  state: OpenProjectAccountConnectionDialogViewProps["state"],
) {
  return (
    <div className={styles.previewCanvas}>
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="openproject-dialog-preview-title"
      >
        <header className={styles.dialogHeader}>
          <h1 id="openproject-dialog-preview-title">
            Connect your OpenProject account
          </h1>
          <span className={styles.closeButton} aria-hidden="true">
            ×
          </span>
        </header>
        <OpenProjectAccountConnectionDialogView state={state} {...actions} />
      </section>
    </div>
  );
}

export const Starting: Story = {
  render: () => renderState({ kind: "starting" }),
};

export const ReadyToLink: Story = {
  render: () =>
    renderState({ kind: "ready", authorizationUrl: exampleAuthorizationUrl }),
};

export const WaitingForAuthorization: Story = {
  render: () =>
    renderState({ kind: "polling", authorizationUrl: exampleAuthorizationUrl }),
};

export const Denied: Story = {
  render: () => renderState({ kind: "denied" }),
};

export const Unavailable: Story = {
  render: () => renderState({ kind: "unavailable" }),
};

export const URLConfigurationError: Story = {
  render: () => renderState({ kind: "configuration_error" }),
};

export const ExpiredAndRetryable: Story = {
  render: () => renderState({ kind: "expired" }),
};
