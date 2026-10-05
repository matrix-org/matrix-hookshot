import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { formatWorkPackageUpdateForMatrix } from "../../../../../../src/openproject/Format";
import {
  BASE_URL,
  WORK_PACKAGE,
} from "../../../../../../tests/openproject/WorkPackageFixtures";

const ACTOR = { id: 12, name: "Webhook User" };

function UpdateFallback({
  actor,
  changes,
}: {
  actor?: typeof ACTOR;
  changes: string[];
}) {
  const { body } = formatWorkPackageUpdateForMatrix(
    WORK_PACKAGE,
    BASE_URL,
    changes,
    actor,
  );

  return <pre>{body}</pre>;
}

const meta = {
  title: "OpenProject/Work package/Update fallback",
  component: UpdateFallback,
  tags: ["autodocs"],
} satisfies Meta<typeof UpdateFallback>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithActor: Story = {
  args: { actor: ACTOR, changes: ["updated the subject"] },
};

export const WithoutActor: Story = {
  args: { changes: ["updated the subject"] },
};

export const MultipleChanges: Story = {
  args: {
    actor: ACTOR,
    changes: [
      "assigned **Alice**",
      "updated the description",
      "changed the status",
    ],
  },
};
