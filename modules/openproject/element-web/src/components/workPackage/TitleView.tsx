import * as React from "react";
import styles from "./WorkPackage.module.css";

export function TitleView({ subject }: { subject: string }) {
  return <span className={styles.titleLink}>{subject}</span>;
}
