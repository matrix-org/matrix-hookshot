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
import type { OpenProjectProbeResponse } from "../../OpenProjectCapabilityClient";
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
    prepareAction: () => {},
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

export const WithActions: Story = {
  render: () => (
    <ProbeEventStory
      probe={resultState(
        createResponse("ok", [
          {
            id: "assign_self",
            label: "Assign to me",
            command: "!openproject project assign 50",
          },
          {
            id: "mark_done",
            label: "Mark as done",
            command: "!openproject project close 50",
          },
        ]),
      )}
    />
  ),
};

export const Loading: Story = {
  render: () => <ProbeEventStory probe={{ kind: "loading" }} />,
};

export const Verified: Story = {
  render: () => <ProbeEventStory probe={resultState(createResponse("ok"))} />,
};

export const NotConnected: Story = {
  render: () => (
    <ProbeEventStory probe={resultState(createResponse("not_connected"))} />
  ),
};

export const NotAuthorized: Story = {
  render: () => (
    <ProbeEventStory probe={resultState(createResponse("not_authorized"))} />
  ),
};

export const Unavailable: Story = {
  render: () => <ProbeEventStory probe={{ kind: "unavailable" }} />,
};

export const Disabled: Story = {
  render: () => <ProbeEventStory probe={{ kind: "disabled" }} />,
};

function createResponse(
  result: OpenProjectProbeResponse["result"],
  actions?: OpenProjectProbeResponse["actions"],
): OpenProjectProbeResponse {
  return {
    v: 1,
    request_id: "storybook-request",
    integration_id: "openproject",
    result,
    ...(result === "ok" ? { connection: "connected" as const } : {}),
    ...(actions === undefined ? {} : { actions }),
  };
}

function resultState(response: OpenProjectProbeResponse): AnchorProbeState {
  return { kind: "result", result: response.result, response };
}
