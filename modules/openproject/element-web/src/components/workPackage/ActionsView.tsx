import * as React from "react";
import { Button } from "@vector-im/compound-web";
import PopOutIcon from "@vector-im/compound-design-tokens/assets/web/icons/pop-out";
import { safeUrl } from "../../utils/validation";
import styles from "./WorkPackage.module.css";

export function ActionsView({ url }: { url?: string }) {
  // `url` originates in untrusted event content and is sanitised here
  const sanitizedUrl = safeUrl(url);
  if (sanitizedUrl) {
    return (
      <div aria-live="polite" className={styles.actions}>
        <Button
          Icon={PopOutIcon}
          as="a"
          size="md"
          kind="secondary"
          href={sanitizedUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          View package
        </Button>
      </div>
    );
  }

  return null;
}
