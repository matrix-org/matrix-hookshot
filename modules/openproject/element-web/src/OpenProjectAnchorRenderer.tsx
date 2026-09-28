import * as React from "react";
import { useCreateAutoDisposedViewModel } from "@element-hq/web-shared-components";
import type {
  OpenProjectAnchor,
  OpenProjectCapabilityClient,
} from "./OpenProjectCapabilityClient";
import { AnchorView } from "./components/workPackage/AnchorView";
import type { OpenProjectContent } from "./models/OpenProjectMatrixEventContent";
import { AnchorMessageViewModel } from "./viewmodels/workPackage/AnchorMessageViewModel";

export function OpenProjectAnchorRenderer({
  anchor,
  capabilityClient,
  data,
}: {
  anchor: OpenProjectAnchor;
  capabilityClient: OpenProjectCapabilityClient;
  data: OpenProjectContent;
}) {
  const vm = useCreateAutoDisposedViewModel(
    () => new AnchorMessageViewModel({ anchor, capabilityClient, data }),
  );
  return <AnchorView vm={vm} />;
}
