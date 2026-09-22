import * as React from "react";

export function LinkView({
  url,
  children,
}: {
  url?: string;
  children: React.ReactNode;
}) {
  if (url) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }

  return <span>{children}</span>;
}
