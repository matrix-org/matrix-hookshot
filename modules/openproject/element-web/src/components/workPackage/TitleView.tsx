import * as React from "react";
import { safeUrl } from "../../utils/validation";
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
  // `url` originates in untrusted event content and is sanitised here
  const sanitizedUrl = safeUrl(url);
  if (sanitizedUrl) {
    return (
      <TitleLink href={sanitizedUrl}>
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
