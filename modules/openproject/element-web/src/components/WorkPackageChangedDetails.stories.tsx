import type { Meta, StoryObj } from "@storybook/react-vite";
import type {
  OpenProjectWorkPackageChanges,
  OpenProjectWorkPackageContent,
} from "../models/OpenProjectMatrixEventContent";
import { createUpdatedWorkPackageMessageViewModel } from "../viewmodels/WorkPackageMessageViewModel";
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

function createChangedDetail(
  workPackage: OpenProjectWorkPackageContent,
  changes: OpenProjectWorkPackageChanges,
) {
  const viewModel = createUpdatedWorkPackageMessageViewModel({
    "org.matrix.matrix-hookshot.openproject.work_package": workPackage,
    "org.matrix.matrix-hookshot.openproject.work_package.changed": changes,
  });
  if (!viewModel?.changedDetail) {
    throw new Error("Expected story fixture to contain a changed field");
  }
  return viewModel.changedDetail;
}

const meta = {
  title: "OpenProject/Changes",
  component: WorkPackageChangedDetails,
  tags: ["autodocs"],
} satisfies Meta<typeof WorkPackageChangedDetails>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Status: Story = {
  args: {
    detail: createChangedDetail(changedWorkPackage, changedStatusDetails),
  },
};

export const Description: Story = {
  args: {
    detail: createChangedDetail(changedWorkPackage, changedDescriptionDetails),
    descriptionAsDetails: false,
  },
};

export const Assignee: Story = {
  args: {
    detail: createChangedDetail(changedWorkPackage, changedAssigneeDetails),
  },
};

export const Responsible: Story = {
  args: {
    detail: createChangedDetail(changedWorkPackage, changedResponsibleDetails),
  },
};

export const Priority: Story = {
  args: {
    detail: createChangedDetail(changedWorkPackage, changedPriorityDetails),
  },
};

export const DueDate: Story = {
  args: {
    detail: createChangedDetail(changedWorkPackage, changedDueDateDetails),
  },
};

export const PercentageComplete: Story = {
  args: {
    detail: createChangedDetail(changedWorkPackage, changedPercentageDetails),
  },
};

export const Subject: Story = {
  args: {
    detail: createChangedDetail(changedWorkPackage, changedSubjectDetails),
  },
};

export const Type: Story = {
  args: { detail: createChangedDetail(changedWorkPackage, changedTypeDetails) },
};

export const ClearedOptionalValues: Story = {
  args: {
    detail: createChangedDetail(
      clearedOptionalValuesWorkPackage,
      clearedOptionalValuesDetails,
    ),
  },
};
