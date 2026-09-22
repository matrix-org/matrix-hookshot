import * as React from "react";
import type { DescriptionSnapshot } from "../../viewmodels/workPackage/DescriptionSnapshot";
import { DescriptionText } from "./styles";

export function DescriptionView({ plain, html }: DescriptionSnapshot) {
  if (html) {
    // HTML is sanitised from untrusted event content by `safeHtml` when the
    // DescriptionSnapshot is created. Rendering it preserves OpenProject's
    // formatted descriptions; the sanitisation is covered by renderer tests.
    return <DescriptionText dangerouslySetInnerHTML={{ __html: html }} />;
  }

  if (!plain) {
    return null;
  }
  return <DescriptionText>{plain}</DescriptionText>;
}
