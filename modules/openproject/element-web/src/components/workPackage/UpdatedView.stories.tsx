import * as React from "react";
import { MockViewModel } from "@element-hq/web-shared-components";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { UpdatedView } from "./UpdatedView";
import {
  changedDescriptionDetails,
  changedWorkPackage,
  changedContent,
} from "../../../storybook/fixtures";
import type { UpdatedViewSnapshot } from "../../viewmodels/workPackage/UpdatedMessageViewModel";
import { UpdatedMessageViewModel } from "../../viewmodels/workPackage/UpdatedMessageViewModel";

const meta = {
  title: "OpenProject/Work package/UpdatedView",
  component: UpdatedView,
  tags: ["autodocs"],
} satisfies Meta<typeof UpdatedView>;

export default meta;
type Story = StoryObj<{
  data: ConstructorParameters<typeof UpdatedMessageViewModel>[0];
}>;

function UpdatedViewStory({
  data,
}: {
  data: ConstructorParameters<typeof UpdatedMessageViewModel>[0];
}) {
  const snapshot = new UpdatedMessageViewModel(data).getSnapshot();
  if (!snapshot) {
    return null;
  }
  const vm = new MockViewModel<UpdatedViewSnapshot>(snapshot);
  return <UpdatedView vm={vm} />;
}

export const Default: Story = {
  render: () => <UpdatedViewStory data={changedContent} />,
};

export const ChangedDescriptionAsDetails: Story = {
  render: () => (
    <UpdatedViewStory
      data={{
        "org.matrix.matrix-hookshot.openproject.work_package":
          changedWorkPackage,
        "org.matrix.matrix-hookshot.openproject.work_package.changed":
          changedDescriptionDetails,
      }}
    />
  ),
};
