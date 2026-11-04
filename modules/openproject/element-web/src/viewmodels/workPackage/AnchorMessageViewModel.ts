import {
  BaseViewModel,
  type ViewModel,
} from "@element-hq/web-shared-components";
import {
  isOpenProjectAnchorContent,
  type OpenProjectAnchor,
  type OpenProjectCapabilityAction,
  type OpenProjectCapabilityClient,
  isOpenProjectProbeResponse,
  type OpenProjectProbeResponse,
} from "../../OpenProjectCapabilityClient";
import type { MatrixSessionIdentity } from "../../HookshotToDeviceClient";
import type { OpenProjectContent } from "../../models/OpenProjectMatrixEventContent";
import { createDetailsSnapshot, type DetailsSnapshot } from "./DetailsSnapshot";

export type AnchorProbeState =
  | { readonly kind: "loading" }
  | {
      readonly kind: "result";
      readonly result: OpenProjectProbeResponse["result"];
      readonly response: OpenProjectProbeResponse;
    }
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
  /** Revalidates and forwards the exact command for an available action. */
  prepareAction: (action: OpenProjectCapabilityAction) => void;
}

export type AnchorViewModel = ViewModel<
  AnchorViewSnapshot | null,
  AnchorViewActions
>;

export interface AnchorMessageViewModelProps {
  readonly anchor?: OpenProjectAnchor;
  readonly capabilityClient?: OpenProjectCapabilityClient;
  readonly data: OpenProjectContent;
  /** Called with the exact validated Hookshot command for the selected action. */
  readonly onActionCommand?: (command: string) => void;
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
  private probeSessionIdentity: MatrixSessionIdentity | undefined;

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
    this.probeSessionIdentity = undefined;
    void this.probe();
  };

  public prepareAction = (action: OpenProjectCapabilityAction): void => {
    const snapshot = this.getSnapshot();
    const response =
      snapshot?.probe.kind === "result" ? snapshot.probe.response : undefined;
    const anchor = this.props.anchor;
    const capabilityClient = this.props.capabilityClient;
    const sessionIdentity = this.probeSessionIdentity;

    if (
      snapshot?.anchor.state !== "active" ||
      !response ||
      response.result !== "ok" ||
      !anchor ||
      !capabilityClient ||
      !sessionIdentity ||
      !capabilityClient.isSessionIdentityCurrent(sessionIdentity) ||
      !isOpenProjectProbeResponse(response, anchor.workPackageId) ||
      !response.actions?.some(
        (availableAction) =>
          availableAction.id === action.id &&
          availableAction.label === action.label &&
          availableAction.command === action.command,
      )
    ) {
      if (
        sessionIdentity &&
        capabilityClient &&
        !capabilityClient.isSessionIdentityCurrent(sessionIdentity) &&
        !this.isDisposed
      ) {
        this.probeSessionIdentity = undefined;
        this.snapshot.merge({ probe: { kind: "unavailable" } });
      }
      return;
    }

    this.props.onActionCommand?.(action.command);
  };

  private async probe(): Promise<void> {
    if (
      this.getSnapshot()?.anchor.state !== "active" ||
      !this.props.capabilityClient ||
      !this.props.anchor
    ) {
      return;
    }

    const anchor = this.props.anchor;
    const attempt = ++this.probeAttempt;
    let sessionIdentity: MatrixSessionIdentity;
    try {
      sessionIdentity = this.props.capabilityClient.getSessionIdentity();
    } catch {
      this.snapshot.merge({ probe: { kind: "unavailable" } });
      return;
    }
    this.probeSessionIdentity = undefined;

    try {
      const response = await this.props.capabilityClient.probe(anchor);
      if (this.isCurrentAttempt(attempt)) {
        if (!isOpenProjectProbeResponse(response, anchor.workPackageId)) {
          this.snapshot.merge({ probe: { kind: "unavailable" } });
          return;
        }
        this.probeSessionIdentity = sessionIdentity;
        this.snapshot.merge({
          probe: { kind: "result", result: response.result, response },
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
