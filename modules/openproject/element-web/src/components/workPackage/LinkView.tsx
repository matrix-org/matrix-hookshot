import * as React from "react";
import { safeUrl } from "../../utils/validation";
import styles from "./WorkPackage.module.css";
import classnames from "classnames";

export function LinkView({
  url,
  className,
  children,
}: {
  url?: string;
  className?: string;
  children: React.ReactNode;
}) {
  // `url` originates in untrusted event content and is sanitised here
  const sanitizedUrl = safeUrl(url);
  if (sanitizedUrl) {
    return (
      <a
        className={classnames(styles.link, className)}
        href={sanitizedUrl}
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    );
  }

  return <span className={className}>{children}</span>;
}
