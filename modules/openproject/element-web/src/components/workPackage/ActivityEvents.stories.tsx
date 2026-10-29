import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ActivityView } from "./ActivityView";
import type { OpenProjectActivityContent } from "../../models/OpenProjectMatrixEventContent";
import { ActivityMessageViewModel } from "../../viewmodels/workPackage/ActivityMessageViewModel";
import {
  activityWithActor,
  activityWithoutActor,
  activityWithNoChanges,
  linkedActivity,
} from "../../../storybook/fixtures";

function ActivityEventStory({ data }: { data: OpenProjectActivityContent }) {
  const vm = new ActivityMessageViewModel({
    data,
    roomId: "!openproject:example.org",
    onViewTimelineCard: () => {},
  });
  return <ActivityView vm={vm} />;
}

const meta = {
  title: "OpenProject/Work package/Activity events",
  component: ActivityEventStory,
  tags: ["autodocs"],
} satisfies Meta<typeof ActivityEventStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithActor: Story = {
  args: { data: activityWithActor },
};

export const WithoutActor: Story = {
  args: { data: activityWithoutActor },
};

export const WithoutChanges: Story = {
  args: { data: activityWithNoChanges },
};

export const WithTimelineCard: Story = {
  args: { data: linkedActivity },
};
