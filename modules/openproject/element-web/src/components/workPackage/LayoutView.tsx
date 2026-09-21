import * as React from "react";
import {
  WorkPackageBorder,
  WorkPackageRoot,
  WorkPackageWrapper,
} from "./styles";

export function LayoutView({
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
