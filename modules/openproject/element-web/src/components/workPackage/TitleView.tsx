import * as React from "react";
import { safeUrl } from "../../utils/validation";
import styles from "./WorkPackage.module.css";
import { LinkView } from "./LinkView";

export function TitleView({
  id,
  subject,
  url,
}: {
  id: number;
  subject: string;
  url?: string;
}) {
  // `url` originates in untrusted event content and is sanitised here
  const sanitizedUrl = safeUrl(url);
  if (sanitizedUrl) {
    return (
      <LinkView className={styles.titleLink} url={sanitizedUrl}>
        #{id} {subject}
      </LinkView>
    );
  }

  return (
    <span className={styles.titleLink}>
      #{id} {subject}
    </span>
  );
}
