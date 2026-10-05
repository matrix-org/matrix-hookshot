import * as React from "react";
import { MockViewModel } from "@element-hq/web-shared-components";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { UpdateView } from "./UpdateView";
import type { OpenProjectUpdateContent } from "../../models/OpenProjectMatrixEventContent";
import {
  UpdateMessageViewModel,
  type UpdateViewSnapshot,
} from "../../viewmodels/workPackage/UpdateMessageViewModel";

const updateBase = {
  "org.matrix.matrix-hookshot.openproject.work_package": {
    id: 57,
    subject: "Add project overview",
    url: "https://openproject.example/work_packages/57",
  },
  "org.matrix.matrix-hookshot.openproject.schema_version": 1,
  "org.matrix.matrix-hookshot.openproject.event_kind": "update",
} as const;

const updateWithActor = {
  ...updateBase,
  "org.matrix.matrix-hookshot.openproject.actor": {
    id: 1,
    name: "Ada Lovelace",
    url: "https://openproject.example/users/1",
  },
  "org.matrix.matrix-hookshot.openproject.changes": [
    "assigned **Grace Hopper**",
    "updated the subject",
  ],
} satisfies OpenProjectUpdateContent;

const updateWithoutActor = {
  ...updateBase,
  "org.matrix.matrix-hookshot.openproject.changes": ["updated the description"],
} satisfies OpenProjectUpdateContent;

const updateWithNoChanges = {
  ...updateBase,
  "org.matrix.matrix-hookshot.openproject.changes": [],
} satisfies OpenProjectUpdateContent;

function UpdateEventStory({ data }: { data: OpenProjectUpdateContent }) {
  const snapshot = new UpdateMessageViewModel(data).getSnapshot();
  if (!snapshot) {
    return null;
  }

  return <UpdateView vm={new MockViewModel<UpdateViewSnapshot>(snapshot)} />;
}

const meta = {
  title: "OpenProject/Work package/Update events",
  component: UpdateEventStory,
  tags: ["autodocs"],
} satisfies Meta<typeof UpdateEventStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithActor: Story = {
  args: { data: updateWithActor },
};

export const WithoutActor: Story = {
  args: { data: updateWithoutActor },
};

export const WithoutChanges: Story = {
  args: { data: updateWithNoChanges },
};
