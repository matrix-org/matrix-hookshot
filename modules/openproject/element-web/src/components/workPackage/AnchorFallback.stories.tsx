import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { formatWorkPackageAnchorContent } from "../../../../../../src/openproject/Format";
import { OPENPROJECT_ANCHOR_STATE_INACTIVE } from "../../../../../../src/openproject/Schema";
import {
  BASE_URL,
  WORK_PACKAGE,
} from "../../../../../../tests/openproject/WorkPackageFixtures";

function AnchorFallback({ inactive = false }: { inactive?: boolean }) {
  const { body } = formatWorkPackageAnchorContent(
    WORK_PACKAGE,
    BASE_URL,
    inactive ? OPENPROJECT_ANCHOR_STATE_INACTIVE : undefined,
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
