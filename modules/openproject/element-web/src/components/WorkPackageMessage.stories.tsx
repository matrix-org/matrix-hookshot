import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  changedDescriptionDetails,
  changedWorkPackage,
  completeWorkPackage,
  createdContent,
  clearedOptionalValuesWorkPackage,
  describedContent,
  untrustedWorkPackage,
} from "./storybook.fixtures";
import {
  WorkPackageCreatedMessage,
  WorkPackageUpdatedMessage,
} from "./WorkPackageMessage";

const meta = {
  title: "OpenProject/Message",
  component: WorkPackageCreatedMessage,
  tags: ["autodocs"],
} satisfies Meta<typeof WorkPackageCreatedMessage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CreatedMinimal: Story = {
  args: { data: createdContent },
};

export const CreatedWithDescription: Story = {
  args: { data: describedContent },
};

export const CreatedWithAllMetadata: Story = {
  args: {
    data: {
      "org.matrix.matrix-hookshot.openproject.work_package":
        completeWorkPackage,
    },
  },
};

export const CreatedWithClearedOptionalValues: Story = {
  args: {
    data: {
      "org.matrix.matrix-hookshot.openproject.work_package":
        clearedOptionalValuesWorkPackage,
    },
  },
};

export const ChangedAssigneeTakesPrecedence: Story = {
  args: {
    data: {
      "org.matrix.matrix-hookshot.openproject.work_package": changedWorkPackage,
      "org.matrix.matrix-hookshot.openproject.work_package.changed": {
        assignee: 2,
        status: { name: "New", color: "#6b7280" },
      },
    },
  },
  render: ({ data }) => <WorkPackageUpdatedMessage data={data} />,
};

export const ChangedDescriptionAsDetails: Story = {
  args: {
    data: {
      "org.matrix.matrix-hookshot.openproject.work_package": changedWorkPackage,
      "org.matrix.matrix-hookshot.openproject.work_package.changed":
        changedDescriptionDetails,
    },
  },
  render: ({ data }) => <WorkPackageUpdatedMessage data={data} />,
};

export const UntrustedInput: Story = {
  args: {
    data: {
      "org.matrix.matrix-hookshot.openproject.work_package":
        untrustedWorkPackage,
    },
  },
};
