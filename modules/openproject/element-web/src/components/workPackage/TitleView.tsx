import * as React from "react";
import { TitleLink } from "./styles";

export function TitleView({
  id,
  subject,
  url,
}: {
  id: number;
  subject: string;
  url?: string;
}) {
  if (url) {
    return (
      <TitleLink href={url}>
        #{id} {subject}
      </TitleLink>
    );
  }

  return (
    <span>
      #{id} {subject}
    </span>
  );
}
