import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  OPENPROJECT_ANCHOR_EVENT_KIND,
  OPENPROJECT_ANCHOR_STATE_ACTIVE,
  OPENPROJECT_EVENT_SCHEMA_VERSION,
} from "../../OpenProjectSchema";
import type { OpenProjectActiveAnchorContent } from "../../models/OpenProjectMatrixEventContent";
import {
  AnchorMessageViewModel,
  type AnchorProbeState,
  type AnchorViewModel,
  type AnchorViewSnapshot,
} from "../../viewmodels/workPackage/AnchorMessageViewModel";
import { minimalWorkPackage, project } from "../../../storybook/fixtures";
import { AnchorView } from "./AnchorView";

const minimalAnchorContent = {
  "org.matrix.matrix-hookshot.openproject.work_package": {
    ...minimalWorkPackage,
    date: null,
    dueDate: null,
    deadline: null,
    status: { ...minimalWorkPackage.status, isClosed: false },
  },
  "org.matrix.matrix-hookshot.openproject.project": project,
  "org.matrix.matrix-hookshot.openproject.schema_version":
    OPENPROJECT_EVENT_SCHEMA_VERSION,
  "org.matrix.matrix-hookshot.openproject.event_kind":
    OPENPROJECT_ANCHOR_EVENT_KIND,
  "org.matrix.matrix-hookshot.openproject.anchor_state":
    OPENPROJECT_ANCHOR_STATE_ACTIVE,
  "org.matrix.matrix-hookshot.openproject.snapshot_id":
    "storybook-probe-minimal",
} satisfies OpenProjectActiveAnchorContent;

function ProbeEventStory({ probe }: { probe: AnchorProbeState }) {
  const snapshot = new AnchorMessageViewModel({
    data: minimalAnchorContent,
  }).getSnapshot();
  if (!snapshot) {
    return null;
  }

  const probeSnapshot: AnchorViewSnapshot = { ...snapshot, probe };
  const vm: AnchorViewModel = {
    getSnapshot: () => probeSnapshot,
    subscribe: () => () => {},
    retry: () => {},
  };

  return <AnchorView vm={vm} />;
}

const meta = {
  title: "OpenProject/Work package/Probe events",
  component: AnchorView,
  tags: ["autodocs"],
} satisfies Meta<typeof AnchorView>;

export default meta;
type Story = StoryObj;

export const Loading: Story = {
  render: () => <ProbeEventStory probe={{ kind: "loading" }} />,
};

export const Verified: Story = {
  render: () => <ProbeEventStory probe={{ kind: "result", result: "ok" }} />,
};

export const NotConnected: Story = {
  render: () => (
    <ProbeEventStory probe={{ kind: "result", result: "not_connected" }} />
  ),
};

export const NotAuthorized: Story = {
  render: () => (
    <ProbeEventStory probe={{ kind: "result", result: "not_authorized" }} />
  ),
};

export const Unavailable: Story = {
  render: () => <ProbeEventStory probe={{ kind: "unavailable" }} />,
};

export const Disabled: Story = {
  render: () => <ProbeEventStory probe={{ kind: "disabled" }} />,
};
