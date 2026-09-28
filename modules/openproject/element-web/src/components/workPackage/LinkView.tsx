import * as React from "react";
import { safeUrl } from "../../utils/validation";

export function LinkView({
  url,
  children,
}: {
  url?: string;
  children: React.ReactNode;
}) {
  // `url` originates in untrusted event content and is sanitised here
  const sanitizedUrl = safeUrl(url);
  if (sanitizedUrl) {
    return (
      <a href={sanitizedUrl} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }

  return <span>{children}</span>;
}
