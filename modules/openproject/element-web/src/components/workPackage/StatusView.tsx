import * as React from "react";
import { StatusIndicator } from "./styles";

export function StatusView({ name, color }: { name: string; color?: string }) {
  return (
    <span>
      <StatusIndicator {...(color ? { style: { background: color } } : {})} />
      {name}
    </span>
  );
}
