import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  formatWorkPackageAnchorContent,
  type OpenProjectAnchorFormatOptions,
} from "../../../../../../src/openproject/Format";
import { OPENPROJECT_ANCHOR_STATE_INACTIVE } from "../../../../../../src/openproject/Schema";
import {
  BASE_URL,
  WORK_PACKAGE,
} from "../../../../../../tests/openproject/WorkPackageFixtures";

function AnchorFallback({ inactive = false }: { inactive?: boolean }) {
  const options: OpenProjectAnchorFormatOptions = {
    snapshotId: "00000000-0000-4000-8000-000000000001",
    ...(inactive ? { anchorState: OPENPROJECT_ANCHOR_STATE_INACTIVE } : {}),
  };
  const { body } = formatWorkPackageAnchorContent(
    WORK_PACKAGE,
    BASE_URL,
    options,
  );

  return <pre>{body}</pre>;
}

const meta = {
  title: "OpenProject/Work package/Anchor fallback",
  component: AnchorFallback,
  tags: ["autodocs"],
} satisfies Meta<typeof AnchorFallback>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PlainFallback: Story = {
  render: () => <AnchorFallback />,
};

export const InactiveFallback: Story = {
  render: () => <AnchorFallback inactive />,
};
