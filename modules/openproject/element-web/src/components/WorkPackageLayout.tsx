import * as React from "react";
import {
  WorkPackageBorder,
  WorkPackageRoot,
  WorkPackageWrapper,
} from "./WorkPackageStyles";

export function WorkPackageLayout({
  borderColor,
  children,
}: {
  borderColor?: string;
  children: React.ReactNode;
}) {
  return (
    <WorkPackageWrapper>
      <WorkPackageBorder
        {...(borderColor ? { style: { background: borderColor } } : {})}
      />
      <WorkPackageRoot>{children}</WorkPackageRoot>
    </WorkPackageWrapper>
  );
}
