import * as React from "react";
import { useCreateAutoDisposedViewModel } from "@element-hq/web-shared-components";
import { UpdateView } from "./components/workPackage/UpdateView";
import {
  UpdateMessageViewModel,
  type OpenProjectUpdateEventContent,
} from "./viewmodels/workPackage/UpdateMessageViewModel";

export function OpenProjectUpdateRenderer({
  data,
}: {
  data: OpenProjectUpdateEventContent;
}) {
  const vm = useCreateAutoDisposedViewModel(
    () => new UpdateMessageViewModel(data),
  );
  return <UpdateView vm={vm} />;
}
