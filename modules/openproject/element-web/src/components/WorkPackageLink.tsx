import * as React from "react";
import { safeUrl } from "../utils/validation";

export function WorkPackageLink({
  url,
  children,
}: {
  url: unknown;
  children: React.ReactNode;
}) {
  const refLink = safeUrl(url);

  if (refLink) {
    return <a href={refLink}>{children}</a>;
  }

  return <span>{children}</span>;
}
