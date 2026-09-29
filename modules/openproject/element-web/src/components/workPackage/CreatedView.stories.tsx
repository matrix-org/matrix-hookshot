import * as React from "react";
import { MockViewModel } from "@element-hq/web-shared-components";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { CreatedView } from "./CreatedView";
import {
  completeWorkPackage,
  createdContent,
  describedContent,
  untrustedWorkPackage,
} from "../../../storybook/fixtures";
import {
  CreatedMessageViewModel,
  type CreatedViewSnapshot,
} from "../../viewmodels/workPackage/CreatedMessageViewModel";

const meta = {
  title: "OpenProject/Work package/CreatedView",
  component: CreatedView,
  tags: ["autodocs"],
} satisfies Meta<typeof CreatedView>;

export default meta;
type Story = StoryObj<{
  data: ConstructorParameters<typeof CreatedMessageViewModel>[0];
}>;

function CreatedViewStory({
  data,
}: {
  data: ConstructorParameters<typeof CreatedMessageViewModel>[0];
}) {
  const snapshot = new CreatedMessageViewModel(data).getSnapshot();
  if (!snapshot) {
    return null;
  }
  const vm = new MockViewModel<CreatedViewSnapshot>(snapshot);
  return <CreatedView vm={vm} />;
}

export const CreatedMinimal: Story = {
  render: () => <CreatedViewStory data={createdContent} />,
};

export const CreatedWithDescription: Story = {
  render: () => <CreatedViewStory data={describedContent} />,
};

export const CreatedWithAllMetadata: Story = {
  render: () => (
    <CreatedViewStory
      data={{
        "org.matrix.matrix-hookshot.openproject.work_package":
          completeWorkPackage,
      }}
    />
  ),
};

export const UntrustedInput: Story = {
  render: () => (
    <CreatedViewStory
      data={{
        "org.matrix.matrix-hookshot.openproject.work_package":
          untrustedWorkPackage,
      }}
    />
  ),
};
