import {
  BaseViewModel,
  type ViewModel,
} from "@element-hq/web-shared-components";
import {
  isOpenProjectAnchorContent,
  type OpenProjectAnchor,
  type OpenProjectCapabilityClient,
  type OpenProjectProbeResult,
} from "../../OpenProjectCapabilityClient";
import type { OpenProjectContent } from "../../models/OpenProjectMatrixEventContent";
import { createDetailsSnapshot, type DetailsSnapshot } from "./DetailsSnapshot";

export type AnchorProbeState =
  | { readonly kind: "loading" }
  | { readonly kind: "result"; readonly result: OpenProjectProbeResult }
  | { readonly kind: "unavailable" }
  | { readonly kind: "disabled" };

export type AnchorState =
  | { readonly state: "active" }
  | { readonly state: "inactive" };

export interface AnchorViewSnapshot {
  readonly kind: "anchor";
  readonly details: DetailsSnapshot;
  readonly anchor: AnchorState;
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
  readonly anchor?: OpenProjectAnchor;
  readonly capabilityClient?: OpenProjectCapabilityClient;
  readonly data: OpenProjectContent;
}

function createAnchorViewSnapshot(
  data: OpenProjectContent,
  capabilityClient?: OpenProjectCapabilityClient,
): AnchorViewSnapshot | null {
  const workPackage =
    data["org.matrix.matrix-hookshot.openproject.work_package"];
  const project = data["org.matrix.matrix-hookshot.openproject.project"];
  if (!workPackage || !project) {
    return null;
  }

  const details = createDetailsSnapshot({ workPackage, project });
  const anchor: AnchorState = {
    state: isOpenProjectAnchorContent(data)
      ? data["org.matrix.matrix-hookshot.openproject.anchor_state"]
      : "inactive",
  };
  const canProbe = anchor.state === "active" && capabilityClient !== undefined;

  return {
    kind: "anchor",
    details,
    anchor,
    probe: canProbe ? { kind: "loading" } : { kind: "disabled" },
  };
}

export class AnchorMessageViewModel
  extends BaseViewModel<AnchorViewSnapshot | null, AnchorMessageViewModelProps>
  implements AnchorViewModel
{
  private probeAttempt = 0;

  public constructor(props: AnchorMessageViewModelProps) {
    super(props, createAnchorViewSnapshot(props.data, props.capabilityClient));
    if (
      this.getSnapshot()?.anchor.state === "active" &&
      props.capabilityClient &&
      props.anchor
    ) {
      void this.probe();
    }
  }

  public retry = (): void => {
    const snapshot = this.getSnapshot();
    if (
      snapshot?.anchor.state !== "active" ||
      !this.props.capabilityClient ||
      !this.props.anchor
    ) {
      return;
    }

    this.snapshot.merge({ probe: { kind: "loading" } });
    void this.probe(true);
  };

  private async probe(force = false): Promise<void> {
    if (
      this.getSnapshot()?.anchor.state !== "active" ||
      !this.props.capabilityClient ||
      !this.props.anchor
    ) {
      return;
    }

    const anchor = this.props.anchor;

    const attempt = ++this.probeAttempt;

    try {
      const response = await this.props.capabilityClient.probe(anchor, {
        force,
      });
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
