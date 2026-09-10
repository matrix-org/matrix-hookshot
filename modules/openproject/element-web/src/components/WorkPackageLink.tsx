import * as React from "react";
import { safeUrl } from "./validation";

export function WorkPackageLink({
  url,
  children,
}: {
  url: unknown;
  children: React.ReactNode;
}) {
  return <a href={safeUrl(url)}>{children}</a>;
}
