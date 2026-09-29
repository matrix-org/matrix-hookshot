import * as React from "react";
import { safeColor } from "../../utils/validation";
import styles from "./WorkPackage.module.css";

export function StatusView({ name, color }: { name: string; color?: string }) {
  // `color` originates in untrusted event content and is sanitised here
  const sanitizedColor = safeColor(color);
  return (
    <span>
      <div
        className={styles.statusIndicator}
        {...(sanitizedColor ? { style: { background: sanitizedColor } } : {})}
      />
      {name}
    </span>
  );
}
