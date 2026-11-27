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
} from "../../capabilities/OpenProjectCapabilityClient";
import type { ProfileIdentity } from "../../capabilities/OpenProjectProfile";
import type { OpenProjectConnectionNotifier } from "../../OpenProjectConnectionNotifier";
import { isTrustedOpenProjectAuthorizationUrl } from "../../utils/config";
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
  /** Whether the current probe and trusted configuration allow account linking. */
  readonly canConnect: boolean;
}

export interface AnchorViewActions {
  retry: () => void;
  /** Revalidates and forwards the exact command for an available action. */
  prepareAction: (action: OpenProjectCapabilityAction) => void;
  /** Revalidates the anchor, login capability, configuration, and session. */
  connectAccount: () => void;
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
  /** Set by the module after verifying the anchor sender matches its bot. */
  readonly isTrustedAnchor?: boolean;
  readonly baseUrl?: URL;
  readonly connectionNotifier?: OpenProjectConnectionNotifier;
  readonly onConnectAccount?: (anchor: OpenProjectAnchor) => void;
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
    canConnect: false,
  };
}

export class AnchorMessageViewModel
  extends BaseViewModel<AnchorViewSnapshot | null, AnchorMessageViewModelProps>
  implements AnchorViewModel
{
  private probeAttempt = 0;
  private probeSessionIdentity: ProfileIdentity | undefined;
  private probeAttemptIdentity: ProfileIdentity | undefined;
  private unsubscribeSession: (() => void) | undefined;
  private unsubscribeConnection: (() => void) | undefined;

  public constructor(props: AnchorMessageViewModelProps) {
    super(props, createAnchorViewSnapshot(props.data, props.capabilityClient));
    if (
      this.getSnapshot()?.anchor.state === "active" &&
      props.capabilityClient &&
      props.anchor
    ) {
      void this.probe();
    }
    if (props.connectionNotifier) {
      this.unsubscribeConnection = props.connectionNotifier.subscribe(
        this.handleConnectionComplete,
      );
    }
  }

  public override dispose(): void {
    this.unsubscribeSession?.();
    this.unsubscribeConnection?.();
    super.dispose();
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
    this.snapshot.merge({ canConnect: false });
    this.probeSessionIdentity = undefined;
    void this.probe(true);
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

  public connectAccount = (): void => {
    const snapshot = this.getSnapshot();
    const response =
      snapshot?.probe.kind === "result" ? snapshot.probe.response : undefined;
    const anchor = this.props.anchor;
    const client = this.props.capabilityClient;
    const identity = this.probeSessionIdentity;
    const trustedBaseUrl = this.props.baseUrl;
    if (
      snapshot?.anchor.state !== "active" ||
      !this.props.isTrustedAnchor ||
      !isOpenProjectAnchorContent(this.props.data) ||
      !anchor ||
      !client ||
      !identity ||
      !client.isSessionIdentityCurrent(identity) ||
      response?.result !== "not_connected" ||
      response.login !== "available" ||
      !trustedBaseUrl ||
      !isTrustedOpenProjectAuthorizationUrl(
        new URL("/oauth/authorize", trustedBaseUrl).toString(),
        trustedBaseUrl,
      )
    ) {
      return;
    }
    this.props.onConnectAccount?.(anchor);
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
    let sessionIdentity: ProfileIdentity;
    try {
      sessionIdentity = this.props.capabilityClient.getSessionIdentity();
    } catch {
      this.snapshot.merge({ probe: { kind: "unavailable" } });
      return;
    }
    this.probeSessionIdentity = undefined;
    this.watchSessionIdentity(sessionIdentity);

    try {
      const response = await this.props.capabilityClient.probe(anchor, {
        force,
      });
      if (this.isCurrentAttempt(attempt)) {
        if (!isOpenProjectProbeResponse(response, anchor.workPackageId)) {
          this.snapshot.merge({ probe: { kind: "unavailable" } });
          return;
        }
        this.probeSessionIdentity = sessionIdentity;
        const canConnect =
          response.result === "not_connected" &&
          response.login === "available" &&
          this.props.isTrustedAnchor === true &&
          this.props.baseUrl !== undefined &&
          this.props.capabilityClient?.isSessionIdentityCurrent(
            sessionIdentity,
          ) === true;
        this.snapshot.merge({
          probe: { kind: "result", result: response.result, response },
          canConnect,
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

  private watchSessionIdentity(identity: ProfileIdentity): void {
    if (
      this.probeAttemptIdentity?.userId === identity.userId &&
      this.probeAttemptIdentity.deviceId === identity.deviceId
    ) {
      return;
    }
    this.unsubscribeSession?.();
    this.probeAttemptIdentity = identity;
    this.unsubscribeSession =
      this.props.capabilityClient?.watchSessionIdentity?.(
        identity,
        this.handleSessionChange,
      );
  }

  private handleSessionChange = (): void => {
    if (this.isDisposed) return;
    this.probeAttempt++;
    this.probeSessionIdentity = undefined;
    this.probeAttemptIdentity = undefined;
    this.snapshot.merge({ probe: { kind: "loading" }, canConnect: false });
    void this.probe(true);
  };

  private handleConnectionComplete = (identity: ProfileIdentity): void => {
    const client = this.props.capabilityClient;
    if (
      this.isDisposed ||
      !client ||
      this.getSnapshot()?.anchor.state !== "active" ||
      !this.probeAttemptIdentity ||
      this.probeAttemptIdentity.userId !== identity.userId ||
      this.probeAttemptIdentity.deviceId !== identity.deviceId ||
      !client.isSessionIdentityCurrent(identity)
    ) {
      return;
    }
    this.probeAttempt++;
    this.probeSessionIdentity = undefined;
    this.snapshot.merge({ probe: { kind: "loading" }, canConnect: false });
    void this.probe(true);
  };
}
