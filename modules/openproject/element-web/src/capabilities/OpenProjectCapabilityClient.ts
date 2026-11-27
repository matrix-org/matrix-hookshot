import {
  OPENPROJECT_ANCHOR_EVENT_KIND,
  OPENPROJECT_ANCHOR_STATE_ACTIVE,
  OPENPROJECT_ANCHOR_STATE_INACTIVE,
  OPENPROJECT_EVENT_SCHEMA_VERSION,
  OPENPROJECT_ACTIVITY_EVENT_KIND,
} from "../schema/OpenProjectSchema";
import type {
  OpenProjectActiveAnchorContent,
  OpenProjectAnchorContent,
  OpenProjectContent,
  OpenProjectInactiveAnchorContent,
  OpenProjectActivityContent,
} from "../models/OpenProjectMatrixEventContent";
import {
  isMatrixEventId,
  isMatrixRoomId,
  isMatrixUserId,
} from "../utils/identifiers";
import type { ToDeviceApi } from "@element-hq/element-web-module-api";
import { OpenProjectProfileMonitor } from "./OpenProjectProfile";
import type {
  OpenProjectProfileWatchable,
  ProfileIdentity,
} from "./OpenProjectProfile";

const PROBE_TIMEOUT_MS = 10_000;

export const OPENPROJECT_INTEGRATION_ID = "openproject";
export const OPENPROJECT_CAPABILITIES_PROBE_EVENT_TYPE =
  "org.matrix.matrix-hookshot.capabilities.probe";
export const OPENPROJECT_CAPABILITIES_PROBE_RESPONSE_EVENT_TYPE =
  "org.matrix.matrix-hookshot.capabilities.probe_response";
export const HOOKSHOT_COMMAND_EVENT_TYPE = "org.matrix.matrix-hookshot.command";
export const HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION = 1;
export const OPENPROJECT_SNAPSHOT_ID_MAX_LENGTH = 255;

export type OpenProjectProbeResult =
  | "ok"
  | "not_connected"
  | "not_authorized"
  | "unavailable";

export interface OpenProjectAnchor {
  readonly roomId: string;
  readonly eventId: string;
  readonly snapshotId: string;
  readonly workPackageId: number;
  readonly recipientUserId: string;
}

export interface OpenProjectProbeResponse {
  v: typeof HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION;
  request_id: string;
  integration_id: typeof OPENPROJECT_INTEGRATION_ID;
  result: OpenProjectProbeResult;
  connection?: "connected" | "not_connected";
  actions?: OpenProjectCapabilityAction[];
}

export interface OpenProjectCapabilityAction {
  id: "assign_self" | "mark_done";
  label: "Assign to me" | "Mark as done";
  command: string;
}

export interface OpenProjectProbeOptions {
  readonly force?: boolean;
}

function createRequestId(): string {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error("Secure request ID generation is unavailable");
  }
  return globalThis.crypto.randomUUID();
}

interface JsonRecord {
  [key: string]: unknown;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasValidWorkPackageId(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const id = value.id;
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0;
}

function isOpenProjectSnapshotId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= OPENPROJECT_SNAPSHOT_ID_MAX_LENGTH
  );
}

function isOpenProjectCommandEventType(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value[HOOKSHOT_COMMAND_EVENT_TYPE])) {
    return false;
  }
  const service = value[HOOKSHOT_COMMAND_EVENT_TYPE].service;
  return service === OPENPROJECT_INTEGRATION_ID;
}

export function isOpenProjectCommandContent(
  value: unknown,
  commandIndicators: readonly string[] = ["!openproject "],
): boolean {
  return (
    isOpenProjectCommandRequest(value, commandIndicators) ||
    isOpenProjectCommandEventType(value)
  );
}

export function isOpenProjectCommandRequest(
  value: unknown,
  commandIndicators: readonly string[] = ["!openproject "],
): boolean {
  if (!isRecord(value) || typeof value.body !== "string") {
    return false;
  }

  const body = value.body;
  return commandIndicators.some((indicator) => body.startsWith(indicator));
}

export function isOpenProjectContent(
  value: unknown,
): value is OpenProjectContent {
  return (
    isRecord(value) &&
    hasValidWorkPackageId(
      value["org.matrix.matrix-hookshot.openproject.work_package"],
    )
  );
}

export function isOpenProjectAnchorContent(
  value: unknown,
): value is OpenProjectAnchorContent {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value["org.matrix.matrix-hookshot.openproject.schema_version"] ===
      OPENPROJECT_EVENT_SCHEMA_VERSION &&
    value["org.matrix.matrix-hookshot.openproject.event_kind"] ===
      OPENPROJECT_ANCHOR_EVENT_KIND &&
    hasValidWorkPackageId(
      value["org.matrix.matrix-hookshot.openproject.work_package"],
    ) &&
    isOpenProjectSnapshotId(
      value["org.matrix.matrix-hookshot.openproject.snapshot_id"],
    ) &&
    (value["org.matrix.matrix-hookshot.openproject.anchor_state"] ===
      OPENPROJECT_ANCHOR_STATE_ACTIVE ||
      value["org.matrix.matrix-hookshot.openproject.anchor_state"] ===
        OPENPROJECT_ANCHOR_STATE_INACTIVE)
  );
}

export function isOpenProjectInactiveAnchorContent(
  value: unknown,
): value is OpenProjectInactiveAnchorContent {
  return (
    isOpenProjectAnchorContent(value) &&
    value["org.matrix.matrix-hookshot.openproject.anchor_state"] ===
      OPENPROJECT_ANCHOR_STATE_INACTIVE
  );
}

export function isOpenProjectActiveAnchorContent(
  value: unknown,
): value is OpenProjectActiveAnchorContent {
  return (
    isOpenProjectAnchorContent(value) &&
    value["org.matrix.matrix-hookshot.openproject.anchor_state"] ===
      OPENPROJECT_ANCHOR_STATE_ACTIVE
  );
}

export function isOpenProjectActivityContent(
  value: unknown,
): value is OpenProjectActivityContent {
  return (
    isRecord(value) &&
    value["org.matrix.matrix-hookshot.openproject.schema_version"] ===
      OPENPROJECT_EVENT_SCHEMA_VERSION &&
    value["org.matrix.matrix-hookshot.openproject.event_kind"] ===
      OPENPROJECT_ACTIVITY_EVENT_KIND &&
    hasValidWorkPackageId(
      value["org.matrix.matrix-hookshot.openproject.work_package"],
    )
  );
}

export function isOpenProjectProbeResponse(
  value: unknown,
  expectedWorkPackageId?: number,
): value is OpenProjectProbeResponse {
  if (
    !isRecord(value) ||
    Object.keys(value).some(
      (key) =>
        ![
          "v",
          "request_id",
          "integration_id",
          "result",
          "connection",
          "actions",
        ].includes(key),
    )
  ) {
    return false;
  }

  if (
    value.v === HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION &&
    typeof value.request_id === "string" &&
    value.integration_id === OPENPROJECT_INTEGRATION_ID &&
    (value.result === "ok" ||
      value.result === "not_connected" ||
      value.result === "not_authorized" ||
      value.result === "unavailable") &&
    (value.connection === undefined ||
      value.connection === "connected" ||
      value.connection === "not_connected")
  ) {
    if (value.actions !== undefined) {
      if (
        value.result !== "ok" ||
        value.connection !== "connected" ||
        !Array.isArray(value.actions) ||
        value.actions.length > 2 ||
        !value.actions.every((action) =>
          isOpenProjectCapabilityAction(action, expectedWorkPackageId),
        ) ||
        new Set(value.actions.map((action) => action.id)).size !==
          value.actions.length
      ) {
        return false;
      }
    }
    if (value.result === "ok") {
      return value.connection === undefined || value.connection === "connected";
    }
    if (value.result === "not_connected") {
      return (
        (value.connection === undefined ||
          value.connection === "not_connected") &&
        value.actions === undefined
      );
    }
    return value.connection === undefined && value.actions === undefined;
  }
  return false;
}

function isOpenProjectCapabilityAction(
  value: unknown,
  expectedWorkPackageId?: number,
): value is OpenProjectCapabilityAction {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !["id", "label", "command"].includes(key))
  ) {
    return false;
  }
  if (value.id !== "assign_self" && value.id !== "mark_done") {
    return false;
  }
  const expectedLabel =
    value.id === "assign_self" ? "Assign to me" : "Mark as done";
  if (value.label !== expectedLabel || typeof value.command !== "string") {
    return false;
  }
  const command = /^(.{2,48}) (assign|close) ([1-9]\d{0,15})$/u.exec(
    value.command,
  );
  if (
    !command ||
    command[1].trim() !== command[1] ||
    /[\p{Cc}]/u.test(command[1])
  ) {
    return false;
  }
  const workPackageId = Number(command[3]);
  return (
    Number.isSafeInteger(workPackageId) &&
    workPackageId > 0 &&
    (expectedWorkPackageId === undefined ||
      workPackageId === expectedWorkPackageId) &&
    ((value.id === "assign_self" && command[2] === "assign") ||
      (value.id === "mark_done" && command[2] === "close"))
  );
}

export function getOpenProjectCapabilityBot(
  config: unknown,
): string | undefined {
  if (!isRecord(config)) {
    return undefined;
  }

  const hookshotConfig = config["org.matrix.matrix-hookshot"];
  if (!isRecord(hookshotConfig)) {
    return undefined;
  }

  const integrationBots = hookshotConfig.integrationBots;
  if (!isRecord(integrationBots)) {
    return undefined;
  }

  const botUserId = integrationBots[OPENPROJECT_INTEGRATION_ID];
  return isMatrixUserId(botUserId) ? botUserId : undefined;
}

export function isOpenProjectAnchorForBot(
  content: unknown,
  sender: unknown,
  botUserId: string | undefined,
): content is OpenProjectActiveAnchorContent {
  return (
    botUserId !== undefined &&
    sender === botUserId &&
    isOpenProjectActiveAnchorContent(content)
  );
}

export class OpenProjectCapabilityClient {
  // Completed results cannot be reused safely without a session lifecycle API.
  private readonly pendingProbes = new Map<string, PendingProbeEntry>();
  private readonly profile: OpenProjectProfileMonitor;

  public constructor(
    private readonly toDeviceClient: ToDeviceApi,
    profile: OpenProjectProfileWatchable,
  ) {
    this.profile = new OpenProjectProfileMonitor(profile);
  }

  /** Returns the Matrix user and device currently used for capability probes. */
  public getSessionIdentity(): ProfileIdentity {
    const identity = this.profile.capture();
    if (!identity) {
      throw new Error("No active Matrix user and device");
    }
    return identity;
  }

  /** Checks whether a capability result still belongs to the active session. */
  public isSessionIdentityCurrent(sessionIdentity: ProfileIdentity): boolean {
    return this.profile.isCurrent(sessionIdentity);
  }

  public probe(
    anchor: OpenProjectAnchor,
    options: OpenProjectProbeOptions = {},
  ): Promise<OpenProjectProbeResponse> {
    if (!this.isValidAnchor(anchor)) {
      return Promise.reject(new Error("Invalid OpenProject anchor"));
    }

    const identity = this.profile.capture();
    if (!identity) {
      return Promise.reject(new Error("No active Matrix user and device"));
    }

    const probeKey = this.createProbeKey(anchor, identity);
    if (!options.force) {
      const pending = this.pendingProbes.get(probeKey);
      if (pending) {
        return pending.promise;
      }
    }

    return this.startProbe(anchor, identity, probeKey);
  }

  private startProbe(
    anchor: OpenProjectAnchor,
    identity: ProfileIdentity,
    probeKey: string,
  ): Promise<OpenProjectProbeResponse> {
    let requestId: string;
    try {
      requestId = createRequestId();
    } catch (error) {
      return Promise.reject(error);
    }
    let resolveProbe!: (response: OpenProjectProbeResponse) => void;
    let rejectProbe!: (error: Error) => void;
    const promise = new Promise<OpenProjectProbeResponse>((resolve, reject) => {
      resolveProbe = resolve;
      rejectProbe = reject;
    });
    const entry: PendingProbeEntry = { promise };
    this.pendingProbes.set(probeKey, entry);

    void this.sendAndWaitForResponse(anchor, identity, requestId).then(
      (response) => {
        this.removePendingProbe(probeKey, entry);
        resolveProbe(response);
      },
      (error: unknown) => {
        this.removePendingProbe(probeKey, entry);
        rejectProbe(
          error instanceof Error
            ? error
            : new Error("OpenProject capability probe failed"),
        );
      },
    );
    return promise;
  }

  private async sendAndWaitForResponse(
    anchor: OpenProjectAnchor,
    identity: ProfileIdentity,
    requestId: string,
  ): Promise<OpenProjectProbeResponse> {
    const waiter = this.createResponseWaiter(anchor, identity, requestId);

    try {
      if (!waiter.isPending()) {
        return await waiter.promise;
      }
      if (!this.profile.isCurrent(identity)) {
        throw new Error("Matrix account or device changed");
      }

      const send = this.toDeviceClient
        .sendMessage({
          recipientUserId: anchor.recipientUserId,
          recipientDeviceId: "*",
          type: OPENPROJECT_CAPABILITIES_PROBE_EVENT_TYPE,
          content: {
            v: HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
            request_id: requestId,
            requesting_device_id: identity.deviceId,
            integration_id: OPENPROJECT_INTEGRATION_ID,
            room_id: anchor.roomId,
            anchor_event_id: anchor.eventId,
          },
        })
        .catch((error: unknown) => {
          throw error instanceof Error
            ? error
            : new Error("To-device send failed");
        });
      const [, response] = await Promise.all([send, waiter.promise]);
      if (!this.profile.isCurrent(identity)) {
        throw new Error("Matrix account or device changed");
      }
      return response;
    } catch (error) {
      const probeError =
        error instanceof Error
          ? error
          : new Error("OpenProject capability probe failed");
      waiter.cancel(probeError);
      throw probeError;
    }
  }

  private createResponseWaiter(
    anchor: OpenProjectAnchor,
    identity: ProfileIdentity,
    requestId: string,
  ): ProbeResponseWaiter {
    let resolveResponse!: (response: OpenProjectProbeResponse) => void;
    let rejectResponse!: (error: Error) => void;
    const promise = new Promise<OpenProjectProbeResponse>((resolve, reject) => {
      resolveResponse = resolve;
      rejectResponse = reject;
    });
    let settled = false;
    let unsubscribeMessage = (): void => {};
    let unsubscribeProfile = (): void => {};
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const finish = (
      error: Error | undefined,
      response?: OpenProjectProbeResponse,
    ): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      unsubscribeMessage();
      unsubscribeProfile();
      if (error) {
        rejectResponse(error);
      } else if (response) {
        resolveResponse(response);
      }
    };

    const waiter: ProbeResponseWaiter = {
      promise,
      cancel: (error) => finish(error),
      isPending: () => !settled,
    };

    try {
      unsubscribeProfile = this.profile.watchForChange(identity, () =>
        finish(new Error("Matrix account or device changed")),
      );
      if (settled) {
        unsubscribeProfile();
        return waiter;
      }
      if (!this.profile.isCurrent(identity)) {
        finish(new Error("Matrix account or device changed"));
        return waiter;
      }

      unsubscribeMessage = this.toDeviceClient.onMessage(
        OPENPROJECT_CAPABILITIES_PROBE_RESPONSE_EVENT_TYPE,
        (message) => {
          if (!this.profile.isCurrent(identity)) {
            finish(new Error("Matrix account or device changed"));
            return;
          }
          if (
            message.type !==
              OPENPROJECT_CAPABILITIES_PROBE_RESPONSE_EVENT_TYPE ||
            message.sender !== anchor.recipientUserId ||
            !isOpenProjectProbeResponse(
              message.content,
              anchor.workPackageId,
            ) ||
            message.content.request_id !== requestId
          ) {
            return;
          }
          finish(undefined, message.content);
        },
      );
      if (settled) {
        unsubscribeMessage();
        return waiter;
      }

      timeout = setTimeout(
        () => finish(new Error("OpenProject capability probe timed out")),
        PROBE_TIMEOUT_MS,
      );
      if (!this.profile.isCurrent(identity)) {
        finish(new Error("Matrix account or device changed"));
      }
    } catch (error) {
      finish(
        error instanceof Error ? error : new Error("To-device probe failed"),
      );
    }

    return waiter;
  }

  private createProbeKey(
    anchor: OpenProjectAnchor,
    identity: ProfileIdentity,
  ): string {
    return JSON.stringify([
      identity.userId,
      identity.deviceId,
      OPENPROJECT_INTEGRATION_ID,
      anchor.recipientUserId,
      anchor.roomId,
      anchor.eventId,
      anchor.snapshotId,
      anchor.workPackageId,
    ]);
  }

  private removePendingProbe(probeKey: string, entry: PendingProbeEntry): void {
    if (this.pendingProbes.get(probeKey) === entry) {
      this.pendingProbes.delete(probeKey);
    }
  }

  private isValidAnchor(anchor: OpenProjectAnchor): boolean {
    return (
      isMatrixRoomId(anchor.roomId) &&
      isMatrixEventId(anchor.eventId) &&
      isOpenProjectSnapshotId(anchor.snapshotId) &&
      Number.isSafeInteger(anchor.workPackageId) &&
      anchor.workPackageId > 0 &&
      isMatrixUserId(anchor.recipientUserId)
    );
  }
}

interface PendingProbeEntry {
  readonly promise: Promise<OpenProjectProbeResponse>;
}

interface ProbeResponseWaiter {
  readonly promise: Promise<OpenProjectProbeResponse>;
  readonly cancel: (error: Error) => void;
  readonly isPending: () => boolean;
}
