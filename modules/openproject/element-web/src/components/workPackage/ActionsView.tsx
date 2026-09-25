import * as React from "react";
import { Button } from "@vector-im/compound-web";
import PopOutIcon from "@vector-im/compound-design-tokens/assets/web/icons/pop-out";
import { safeUrl } from "../../utils/validation";

export function ActionsView({ url }: { url?: string }) {
  // `url` originates in untrusted event content and is sanitised here
  const sanitizedUrl = safeUrl(url);
  if (sanitizedUrl) {
    return (
      <Button
        Icon={PopOutIcon}
        as="a"
        size="md"
        kind="primary"
        href={sanitizedUrl}
        target="_blank"
        rel="noopener noreferrer"
      >
        View package
      </Button>
    );
  }

  return null;
}
