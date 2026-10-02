import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  OPENPROJECT_ANCHOR_EVENT_KIND,
  OPENPROJECT_ANCHOR_STATE_ACTIVE,
  OPENPROJECT_ANCHOR_STATE_INACTIVE,
  OPENPROJECT_EVENT_SCHEMA_VERSION,
} from "../../OpenProjectSchema";
import { AnchorView } from "./AnchorView";
import {
  completeWorkPackage,
  minimalWorkPackage,
  project,
  untrustedWorkPackage,
} from "../../../storybook/fixtures";
import type {
  OpenProjectActiveAnchorContent,
  OpenProjectContent,
  OpenProjectInactiveAnchorContent,
} from "../../models/OpenProjectMatrixEventContent";
import {
  AnchorMessageViewModel,
  type AnchorViewModel,
} from "../../viewmodels/workPackage/AnchorMessageViewModel";

const minimalAnchorWorkPackage = {
  ...minimalWorkPackage,
  date: null,
  dueDate: null,
  deadline: null,
  status: { ...minimalWorkPackage.status, isClosed: false },
};

const completeAnchorWorkPackage = {
  ...completeWorkPackage,
  date: null,
  dueDate: "2026-10-15",
  deadline: { date: "2026-10-15", label: "Due" as const },
  status: { ...completeWorkPackage.status, isClosed: false },
};

const activeMinimalContent = {
  "org.matrix.matrix-hookshot.openproject.work_package":
    minimalAnchorWorkPackage,
  "org.matrix.matrix-hookshot.openproject.project": project,
  "org.matrix.matrix-hookshot.openproject.schema_version":
    OPENPROJECT_EVENT_SCHEMA_VERSION,
  "org.matrix.matrix-hookshot.openproject.event_kind":
    OPENPROJECT_ANCHOR_EVENT_KIND,
  "org.matrix.matrix-hookshot.openproject.anchor_state":
    OPENPROJECT_ANCHOR_STATE_ACTIVE,
} satisfies OpenProjectActiveAnchorContent;

const activeContent = {
  ...activeMinimalContent,
  "org.matrix.matrix-hookshot.openproject.work_package":
    completeAnchorWorkPackage,
} satisfies OpenProjectActiveAnchorContent;

const closedContent = {
  ...activeContent,
  "org.matrix.matrix-hookshot.openproject.work_package": {
    ...completeAnchorWorkPackage,
    status: {
      ...completeAnchorWorkPackage.status,
      name: "Done",
      isClosed: true,
    },
  },
} satisfies OpenProjectActiveAnchorContent;

const inactiveContent = {
  ...activeContent,
  "org.matrix.matrix-hookshot.openproject.anchor_state":
    OPENPROJECT_ANCHOR_STATE_INACTIVE,
  "org.matrix.matrix-hookshot.openproject.work_package": {
    ...completeAnchorWorkPackage,
    status: { ...completeAnchorWorkPackage.status, isClosed: false },
  },
} satisfies OpenProjectInactiveAnchorContent;

const untrustedContent = {
  ...activeMinimalContent,
  "org.matrix.matrix-hookshot.openproject.work_package": {
    ...untrustedWorkPackage,
    date: null,
    dueDate: null,
    deadline: null,
    status: { ...untrustedWorkPackage.status, isClosed: false },
  },
} satisfies OpenProjectActiveAnchorContent;

function ActiveAnchorStory({ data }: { data: OpenProjectContent }) {
  const snapshot = new AnchorMessageViewModel({ data }).getSnapshot();
  if (!snapshot) {
    return null;
  }

  const vm: AnchorViewModel = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    retry: () => {},
  };

  return <AnchorView vm={vm} />;
}

const meta = {
  title: "OpenProject/Work package/Anchor events",
  component: AnchorView,
  tags: ["autodocs"],
} satisfies Meta<typeof AnchorView>;

export default meta;
type Story = StoryObj;

export const Active: Story = {
  render: () => <ActiveAnchorStory data={activeContent} />,
};

export const Closed: Story = {
  render: () => <ActiveAnchorStory data={closedContent} />,
};

export const Inactive: Story = {
  render: () => <ActiveAnchorStory data={inactiveContent} />,
};

export const UntrustedInput: Story = {
  render: () => <ActiveAnchorStory data={untrustedContent} />,
};
