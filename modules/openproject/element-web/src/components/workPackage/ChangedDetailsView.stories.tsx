import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChangedDetailsView } from "./ChangedDetailsView";
import {
  changedAssigneeDetails,
  changedDescriptionDetails,
  changedDueDateDetails,
  changedPercentageDetails,
  changedPriorityDetails,
  changedResponsibleDetails,
  changedStatusDetails,
  changedSubjectDetails,
  changedTypeDetails,
  changedWorkPackage,
  clearedOptionalValuesDetails,
  clearedOptionalValuesWorkPackage,
  createWorkPackageChangedDetail,
} from "../../../storybook/fixtures";

const meta = {
  title: "OpenProject/Work package/Changes",
  component: ChangedDetailsView,
  tags: ["autodocs"],
} satisfies Meta<typeof ChangedDetailsView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Status: Story = {
  args: {
    change: createWorkPackageChangedDetail(
      changedWorkPackage,
      changedStatusDetails,
    ),
  },
};

export const Description: Story = {
  args: {
    change: createWorkPackageChangedDetail(
      changedWorkPackage,
      changedDescriptionDetails,
    ),
    descriptionAsDetails: false,
  },
};

export const Assignee: Story = {
  args: {
    change: createWorkPackageChangedDetail(
      changedWorkPackage,
      changedAssigneeDetails,
    ),
  },
};

export const Responsible: Story = {
  args: {
    change: createWorkPackageChangedDetail(
      changedWorkPackage,
      changedResponsibleDetails,
    ),
  },
};

export const Priority: Story = {
  args: {
    change: createWorkPackageChangedDetail(
      changedWorkPackage,
      changedPriorityDetails,
    ),
  },
};

export const DueDate: Story = {
  args: {
    change: createWorkPackageChangedDetail(
      changedWorkPackage,
      changedDueDateDetails,
    ),
  },
};

export const PercentageComplete: Story = {
  args: {
    change: createWorkPackageChangedDetail(
      changedWorkPackage,
      changedPercentageDetails,
    ),
  },
};

export const Subject: Story = {
  args: {
    change: createWorkPackageChangedDetail(
      changedWorkPackage,
      changedSubjectDetails,
    ),
  },
};

export const Type: Story = {
  args: {
    change: createWorkPackageChangedDetail(
      changedWorkPackage,
      changedTypeDetails,
    ),
  },
};

export const ClearedOptionalValues: Story = {
  args: {
    change: createWorkPackageChangedDetail(
      clearedOptionalValuesWorkPackage,
      clearedOptionalValuesDetails,
    ),
  },
};
