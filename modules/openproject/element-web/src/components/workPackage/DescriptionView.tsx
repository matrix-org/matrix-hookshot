import * as React from "react";
import { DescriptionText } from "./styles";

export function DescriptionView({
  plain,
  html,
}: {
  plain: string;
  html?: string;
}) {
  if (html) {
    return <DescriptionText dangerouslySetInnerHTML={{ __html: html }} />;
  }

  if (!plain) {
    return null;
  }
  return <DescriptionText>{plain}</DescriptionText>;
}
