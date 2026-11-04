import * as React from "react";
import { Button } from "@vector-im/compound-web";
import PopOutIcon from "@vector-im/compound-design-tokens/assets/web/icons/pop-out";
import type { OpenProjectCapabilityAction } from "../../OpenProjectCapabilityClient";
import { safeUrl } from "../../utils/validation";
import styles from "./WorkPackage.module.css";

interface ActionsViewProps {
  readonly url?: string;
  readonly actions: readonly OpenProjectCapabilityAction[];
  readonly onAction: (action: OpenProjectCapabilityAction) => void;
}

export function ActionsView({ url, actions, onAction }: ActionsViewProps) {
  // `url` originates in untrusted event content and is sanitised here
  const sanitizedUrl = safeUrl(url);
  if (!sanitizedUrl && actions.length === 0) {
    return null;
  }

  return (
    <div className={styles.actions}>
      {sanitizedUrl && (
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
      )}
      {actions.map((action) => (
        <Button
          key={action.id}
          size="md"
          kind="secondary"
          onClick={() => onAction(action)}
        >
          {action.label}
        </Button>
      ))}
    </div>
  );
}
