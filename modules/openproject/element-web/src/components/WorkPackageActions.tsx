import * as React from "react";
import { Button } from "@vector-im/compound-web";
import PopOutIcon from "@vector-im/compound-design-tokens/assets/web/icons/pop-out";
import { safeUrl } from "./validation";

export function WorkPackageActions({ url }: { url: unknown }) {
  return (
    <Button
      Icon={PopOutIcon}
      as="a"
      size="md"
      kind="secondary"
      href={safeUrl(url)}
      target="_blank"
      rel="noopener noreferrer"
    >
      View package
    </Button>
  );
}
