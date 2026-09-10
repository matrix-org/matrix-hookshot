import * as React from "react";
import { safeColor } from "./validation";
import {
  WorkPackageBorder,
  WorkPackageRoot,
  WorkPackageWrapper,
} from "./WorkPackageStyles";

export function WorkPackageLayout({
  borderColor,
  children,
}: {
  borderColor: unknown;
  children: React.ReactNode;
}) {
  const safeBorderColor = safeColor(borderColor);

  return (
    <WorkPackageWrapper>
      <WorkPackageBorder
        {...(safeBorderColor ? { style: { background: safeBorderColor } } : {})}
      />
      <WorkPackageRoot>{children}</WorkPackageRoot>
    </WorkPackageWrapper>
  );
}
