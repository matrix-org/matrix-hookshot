import * as React from "react";
import { useCreateAutoDisposedViewModel } from "@element-hq/web-shared-components";
import {
  type OpenProjectAnchor,
  type OpenProjectCapabilityClient,
} from "./OpenProjectCapabilityClient";
import { AnchorView } from "./components/workPackage/AnchorView";
import type {
  OpenProjectAnchorContent,
  OpenProjectContent,
} from "./models/OpenProjectMatrixEventContent";
import { AnchorMessageViewModel } from "./viewmodels/workPackage/AnchorMessageViewModel";

export function OpenProjectAnchorRenderer({
  anchor,
  capabilityClient,
  data,
}: {
  anchor: OpenProjectAnchor;
  capabilityClient?: OpenProjectCapabilityClient;
  data: OpenProjectAnchorContent;
}) {
  const snapshotId = data["org.matrix.matrix-hookshot.openproject.snapshot_id"];

  return (
    <React.Fragment key={anchor.eventId}>
      <OpenProjectAnchorCard
        key={snapshotId}
        anchor={anchor}
        capabilityClient={capabilityClient}
        data={data}
      />
    </React.Fragment>
  );
}

function OpenProjectAnchorCard({
  anchor,
  capabilityClient,
  data,
}: {
  anchor: OpenProjectAnchor;
  capabilityClient?: OpenProjectCapabilityClient;
  data: OpenProjectContent;
}) {
  const vm = useCreateAutoDisposedViewModel(
    () => new AnchorMessageViewModel({ anchor, capabilityClient, data }),
  );
  return <AnchorView vm={vm} />;
}
