import * as React from "react";
import { safeColor } from "../../utils/validation";
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
  // `borderColor` originates in untrusted event content and is sanitised here
  const sanitizedBorderColor = safeColor(borderColor);
  return (
    <WorkPackageWrapper>
      <WorkPackageBorder
        {...(sanitizedBorderColor
          ? { style: { background: sanitizedBorderColor } }
          : {})}
      />
      <WorkPackageRoot>{children}</WorkPackageRoot>
    </WorkPackageWrapper>
  );
}
