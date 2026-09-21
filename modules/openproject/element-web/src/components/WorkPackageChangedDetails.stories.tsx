import type { Meta, StoryObj } from "@storybook/react-vite";
import { WorkPackageChangedDetails } from "./WorkPackageChangedDetails";
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
} from "./storybook.fixtures";

const meta = {
  title: "OpenProject/Changes",
  component: WorkPackageChangedDetails,
  tags: ["autodocs"],
} satisfies Meta<typeof WorkPackageChangedDetails>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Status: Story = {
  args: {
    detail: createWorkPackageChangedDetail(
      changedWorkPackage,
      changedStatusDetails,
    ),
  },
};

export const Description: Story = {
  args: {
    detail: createWorkPackageChangedDetail(
      changedWorkPackage,
      changedDescriptionDetails,
    ),
    descriptionAsDetails: false,
  },
};

export const Assignee: Story = {
  args: {
    detail: createWorkPackageChangedDetail(
      changedWorkPackage,
      changedAssigneeDetails,
    ),
  },
};

export const Responsible: Story = {
  args: {
    detail: createWorkPackageChangedDetail(
      changedWorkPackage,
      changedResponsibleDetails,
    ),
  },
};

export const Priority: Story = {
  args: {
    detail: createWorkPackageChangedDetail(
      changedWorkPackage,
      changedPriorityDetails,
    ),
  },
};

export const DueDate: Story = {
  args: {
    detail: createWorkPackageChangedDetail(
      changedWorkPackage,
      changedDueDateDetails,
    ),
  },
};

export const PercentageComplete: Story = {
  args: {
    detail: createWorkPackageChangedDetail(
      changedWorkPackage,
      changedPercentageDetails,
    ),
  },
};

export const Subject: Story = {
  args: {
    detail: createWorkPackageChangedDetail(
      changedWorkPackage,
      changedSubjectDetails,
    ),
  },
};

export const Type: Story = {
  args: {
    detail: createWorkPackageChangedDetail(
      changedWorkPackage,
      changedTypeDetails,
    ),
  },
};

export const ClearedOptionalValues: Story = {
  args: {
    detail: createWorkPackageChangedDetail(
      clearedOptionalValuesWorkPackage,
      clearedOptionalValuesDetails,
    ),
  },
};
