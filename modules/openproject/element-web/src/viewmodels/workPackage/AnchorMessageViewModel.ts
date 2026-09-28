import {
  BaseViewModel,
  type ViewModel,
} from "@element-hq/web-shared-components";
import type {
  OpenProjectAnchor,
  OpenProjectCapabilityClient,
  OpenProjectProbeResult,
} from "../../OpenProjectCapabilityClient";
import type { OpenProjectContent } from "../../models/OpenProjectMatrixEventContent";
import { createDetailsSnapshot, type DetailsSnapshot } from "./DetailsSnapshot";

export type AnchorProbeState =
  | { readonly kind: "loading" }
  | { readonly kind: "result"; readonly result: OpenProjectProbeResult }
  | { readonly kind: "unavailable" };

export interface AnchorViewSnapshot {
  readonly kind: "anchor";
  readonly details: DetailsSnapshot;
  readonly header: {
    readonly action: "created";
    readonly authorName?: string;
  };
  readonly probe: AnchorProbeState;
}

export interface AnchorViewActions {
  retry: () => void;
}

export type AnchorViewModel = ViewModel<
  AnchorViewSnapshot | null,
  AnchorViewActions
>;

export interface AnchorMessageViewModelProps {
  readonly anchor: OpenProjectAnchor;
  readonly capabilityClient: OpenProjectCapabilityClient;
  readonly data: OpenProjectContent;
}

function createAnchorViewSnapshot(
  data: OpenProjectContent,
): AnchorViewSnapshot | null {
  const rawWorkPackage =
    data["org.matrix.matrix-hookshot.openproject.work_package"];
  if (!rawWorkPackage) {
    return null;
  }

  const details = createDetailsSnapshot(rawWorkPackage);
  return {
    kind: "anchor",
    details,
    header: { action: "created", authorName: details.author.name },
    probe: { kind: "loading" },
  };
}

export class AnchorMessageViewModel
  extends BaseViewModel<AnchorViewSnapshot | null, AnchorMessageViewModelProps>
  implements AnchorViewModel
{
  private probeAttempt = 0;

  public constructor(props: AnchorMessageViewModelProps) {
    super(props, createAnchorViewSnapshot(props.data));
    if (this.getSnapshot()) {
      void this.probe();
    }
  }

  public retry = (): void => {
    if (!this.getSnapshot()) {
      return;
    }

    this.snapshot.merge({ probe: { kind: "loading" } });
    void this.probe(true);
  };

  private async probe(force = false): Promise<void> {
    const attempt = ++this.probeAttempt;

    try {
      const response = await this.props.capabilityClient.probe(
        this.props.anchor,
        { force },
      );
      if (this.isCurrentAttempt(attempt)) {
        this.snapshot.merge({
          probe: { kind: "result", result: response.result },
        });
      }
    } catch {
      if (this.isCurrentAttempt(attempt)) {
        this.snapshot.merge({ probe: { kind: "unavailable" } });
      }
    }
  }

  private isCurrentAttempt(attempt: number): boolean {
    return !this.isDisposed && attempt === this.probeAttempt;
  }
}
