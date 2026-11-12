import * as React from "react";
import { TooltipProvider } from "@vector-im/compound-web";
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

interface OpenProjectAnchorRendererProps {
  readonly anchor: OpenProjectAnchor;
  readonly capabilityClient?: OpenProjectCapabilityClient;
  readonly data: OpenProjectAnchorContent;
  readonly onActionCommand?: (command: string) => void;
}

export function OpenProjectAnchorRenderer({
  anchor,
  capabilityClient,
  data,
  onActionCommand,
}: OpenProjectAnchorRendererProps) {
  const snapshotId = data["org.matrix.matrix-hookshot.openproject.snapshot_id"];

  return (
    <TooltipProvider>
      <React.Fragment key={anchor.eventId}>
        <OpenProjectAnchorCard
          key={snapshotId}
          anchor={anchor}
          capabilityClient={capabilityClient}
          data={data}
          onActionCommand={onActionCommand}
        />
      </React.Fragment>
    </TooltipProvider>
  );
}

function OpenProjectAnchorCard({
  anchor,
  capabilityClient,
  data,
  onActionCommand,
}: {
  anchor: OpenProjectAnchor;
  capabilityClient?: OpenProjectCapabilityClient;
  data: OpenProjectContent;
  onActionCommand?: (command: string) => void;
}) {
  const vm = useCreateAutoDisposedViewModel(
    () =>
      new AnchorMessageViewModel({
        anchor,
        capabilityClient,
        data,
        onActionCommand,
      }),
  );
  return <AnchorView vm={vm} />;
}
