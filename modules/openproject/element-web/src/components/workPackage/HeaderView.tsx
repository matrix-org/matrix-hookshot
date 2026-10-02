import * as React from "react";
import { LinkView } from "./LinkView";
import { safeUrl } from "../../utils/validation";
import styles from "./WorkPackage.module.css";

export function HeaderView({
  id,
  url,
  project,
  isClosed,
  action,
}: {
  id: number;
  url?: string;
  project?: string;
  isClosed?: boolean;
  action?: string;
}) {
  // `url` originates in untrusted event content and is sanitised here
  const sanitizedUrl = safeUrl(url);
  const headerPrefix = "OpenProject · ";
  const headerSuffix =
    action === "inactive"
      ? " · (removed from timeline)"
      : isClosed
        ? " · (resolved)"
        : "";
  const headerLink = (project ? `${project} · ` : "") + "#" + id;

  return (
    <div className={styles.header}>
      <span className={styles.avatar} role="img" aria-label="OpenProject">
        OP
      </span>
      <span>
        <span>{headerPrefix}</span>
        <LinkView url={sanitizedUrl}>{headerLink}</LinkView>
        <span>{headerSuffix}</span>
      </span>
    </div>
  );
}
