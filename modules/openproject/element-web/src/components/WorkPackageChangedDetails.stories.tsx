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
} from "./storybook.fixtures";

const meta = {
  title: "OpenProject/Changes",
  component: WorkPackageChangedDetails,
  tags: ["autodocs"],
} satisfies Meta<typeof WorkPackageChangedDetails>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Status: Story = {
  args: { workPackage: changedWorkPackage, changes: changedStatusDetails },
};

export const Description: Story = {
  args: {
    workPackage: changedWorkPackage,
    changes: changedDescriptionDetails,
    descriptionAsDetails: false,
  },
};

export const Assignee: Story = {
  args: { workPackage: changedWorkPackage, changes: changedAssigneeDetails },
};

export const Responsible: Story = {
  args: {
    workPackage: changedWorkPackage,
    changes: changedResponsibleDetails,
  },
};

export const Priority: Story = {
  args: { workPackage: changedWorkPackage, changes: changedPriorityDetails },
};

export const DueDate: Story = {
  args: { workPackage: changedWorkPackage, changes: changedDueDateDetails },
};

export const PercentageComplete: Story = {
  args: {
    workPackage: changedWorkPackage,
    changes: changedPercentageDetails,
  },
};

export const Subject: Story = {
  args: { workPackage: changedWorkPackage, changes: changedSubjectDetails },
};

export const Type: Story = {
  args: { workPackage: changedWorkPackage, changes: changedTypeDetails },
};

export const ClearedOptionalValues: Story = {
  args: {
    workPackage: clearedOptionalValuesWorkPackage,
    changes: clearedOptionalValuesDetails,
  },
};
