import * as React from "react";
import { LinkView } from "./LinkView";

export function HeaderView({
  id,
  url,
  action,
  authorName,
}: {
  id: number;
  url?: string;
  action: "created" | "updated";
  authorName?: string;
}) {
  return (
    <span>
      Work package <LinkView url={url}>{id}</LinkView> {action}
      {authorName ? ` by ${authorName}` : null}
    </span>
  );
}
