import * as React from "react";
import { safeColor } from "../../utils/validation";
import { StatusIndicator } from "./styles";

export function StatusView({ name, color }: { name: string; color?: string }) {
  // `color` originates in untrusted event content and is sanitised here
  const sanitizedColor = safeColor(color);
  return (
    <span>
      <StatusIndicator
        {...(sanitizedColor ? { style: { background: sanitizedColor } } : {})}
      />
      {name}
    </span>
  );
}
