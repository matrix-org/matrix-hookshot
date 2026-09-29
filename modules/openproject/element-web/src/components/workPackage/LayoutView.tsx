import * as React from "react";
import { safeColor } from "../../utils/validation";
import styles from "./WorkPackage.module.css";

export function LayoutView({
  borderColor,
  children,
}: {
  borderColor?: string;
  children: React.ReactNode;
}) {
  // `borderColor` originates in untrusted event content and is sanitised here
  const sanitizedBorderColor = safeColor(borderColor);
  return (
    <div className={styles.layoutWrapper}>
      <div
        className={styles.layoutBorder}
        {...(sanitizedBorderColor
          ? { style: { background: sanitizedBorderColor } }
          : {})}
      />
      <div className={styles.layoutRoot}>{children}</div>
    </div>
  );
}
