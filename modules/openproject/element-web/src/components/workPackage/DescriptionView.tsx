import * as React from "react";
import type { DescriptionSnapshot } from "../../viewmodels/workPackage/DescriptionSnapshot";
import { safeHtml } from "../../utils/validation";
import styles from "./WorkPackage.module.css";

export function DescriptionView({ plain, html }: DescriptionSnapshot) {
  // `html` originates in untrusted event content and is sanitised here
  const sanitizedHtml = safeHtml(html);
  if (sanitizedHtml) {
    return (
      <div
        className={styles.descriptionText}
        dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
      />
    );
  }

  if (!plain) {
    return null;
  }
  return <div className={styles.descriptionText}>{plain}</div>;
}
