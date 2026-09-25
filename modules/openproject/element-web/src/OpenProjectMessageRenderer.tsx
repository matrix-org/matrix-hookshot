import * as React from "react";
import { useCreateAutoDisposedViewModel } from "@element-hq/web-shared-components";
import { CreatedView } from "./components/workPackage/CreatedView";
import { UpdatedView } from "./components/workPackage/UpdatedView";
import type { OpenProjectContent } from "./models/OpenProjectMatrixEventContent";
import { CreatedMessageViewModel } from "./viewmodels/workPackage/CreatedMessageViewModel";
import { UpdatedMessageViewModel } from "./viewmodels/workPackage/UpdatedMessageViewModel";

function CreatedMessageRenderer({ data }: { data: OpenProjectContent }) {
  const vm = useCreateAutoDisposedViewModel(
    () => new CreatedMessageViewModel(data),
  );
  return <CreatedView vm={vm} />;
}

function UpdatedMessageRenderer({ data }: { data: OpenProjectContent }) {
  const vm = useCreateAutoDisposedViewModel(
    () => new UpdatedMessageViewModel(data),
  );
  return <UpdatedView vm={vm} />;
}

export function OpenProjectMessageRenderer({
  data,
}: {
  data: OpenProjectContent;
}) {
  const changed =
    data["org.matrix.matrix-hookshot.openproject.work_package.changed"];
  return changed ? (
    <UpdatedMessageRenderer data={data} />
  ) : (
    <CreatedMessageRenderer data={data} />
  );
}
