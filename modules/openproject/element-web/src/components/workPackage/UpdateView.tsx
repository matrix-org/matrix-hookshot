import * as React from "react";
import { useViewModel } from "@element-hq/web-shared-components";
import type { UpdateViewModel } from "../../viewmodels/workPackage/UpdateMessageViewModel";
import { LinkView } from "./LinkView";

export function UpdateView({ vm }: { vm: UpdateViewModel }) {
  const snapshot = useViewModel(vm);
  if (!snapshot) {
    return null;
  }

  const { workPackage, changeSummary, actor } = snapshot;

  return (
    <span>
      <LinkView url={actor?.url}>{actor?.name ?? "Someone"}</LinkView>{" "}
      {changeSummary} -{" "}
      <LinkView url={workPackage.url}>{workPackage.subject}</LinkView>
    </span>
  );
}
