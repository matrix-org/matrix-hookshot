import * as React from "react";
import { Avatar } from "@vector-im/compound-web";
import { LinkView } from "./LinkView";
import { safeUrl } from "../../utils/validation";
import styles from "./WorkPackage.module.css";
import openProjectAvatar from "../../../../../../assets/openproject_avatar.png";

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
      <Avatar
        src={openProjectAvatar}
        id="OpenProject"
        name="OpenProject"
        type="square"
        size="var(--cpd-space-7x)"
      />
      <span>
        <span>{headerPrefix}</span>
        <LinkView url={sanitizedUrl}>{headerLink}</LinkView>
        <span>{headerSuffix}</span>
      </span>
    </div>
  );
}
