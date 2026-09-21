import * as React from "react";
import { Button } from "@vector-im/compound-web";
import PopOutIcon from "@vector-im/compound-design-tokens/assets/web/icons/pop-out";

export function ActionsView({ url }: { url?: string }) {
  if (url) {
    return (
      <Button
        Icon={PopOutIcon}
        as="a"
        size="md"
        kind="secondary"
        href={url}
        target="_blank"
        rel="noopener noreferrer"
      >
        View package
      </Button>
    );
  }

  return null;
}
