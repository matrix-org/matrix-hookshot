import * as React from "react";
import { TooltipProvider } from "@vector-im/compound-web";
import { useCreateAutoDisposedViewModel } from "@element-hq/web-shared-components";
import type {
  OpenProjectAnchor,
  OpenProjectCapabilityClient,
} from "./capabilities/OpenProjectCapabilityClient";
import type { OpenProjectConnectionNotifier } from "./OpenProjectConnectionNotifier";
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
  readonly isTrustedAnchor?: boolean;
  readonly baseUrl?: URL;
  readonly connectionNotifier?: OpenProjectConnectionNotifier;
  readonly onConnectAccount?: (anchor: OpenProjectAnchor) => void;
}

export function OpenProjectAnchorRenderer({
  anchor,
  capabilityClient,
  data,
  onActionCommand,
  isTrustedAnchor,
  baseUrl,
  connectionNotifier,
  onConnectAccount,
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
          isTrustedAnchor={isTrustedAnchor}
          baseUrl={baseUrl}
          connectionNotifier={connectionNotifier}
          onConnectAccount={onConnectAccount}
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
  isTrustedAnchor,
  baseUrl,
  connectionNotifier,
  onConnectAccount,
}: {
  anchor: OpenProjectAnchor;
  capabilityClient?: OpenProjectCapabilityClient;
  data: OpenProjectContent;
  onActionCommand?: (command: string) => void;
  isTrustedAnchor?: boolean;
  baseUrl?: URL;
  connectionNotifier?: OpenProjectConnectionNotifier;
  onConnectAccount?: (anchor: OpenProjectAnchor) => void;
}) {
  const vm = useCreateAutoDisposedViewModel(
    () =>
      new AnchorMessageViewModel({
        anchor,
        capabilityClient,
        data,
        onActionCommand,
        isTrustedAnchor,
        baseUrl,
        connectionNotifier,
        onConnectAccount,
      }),
  );
  return <AnchorView vm={vm} />;
}
