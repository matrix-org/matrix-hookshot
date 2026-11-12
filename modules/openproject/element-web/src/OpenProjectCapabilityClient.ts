import {
  HookshotToDeviceClient,
  type HookshotToDeviceRequest,
  type MatrixSessionIdentity,
} from "./HookshotToDeviceClient";
import {
  OPENPROJECT_ANCHOR_EVENT_KIND,
  OPENPROJECT_ANCHOR_STATE_ACTIVE,
  OPENPROJECT_ANCHOR_STATE_INACTIVE,
  OPENPROJECT_EVENT_SCHEMA_VERSION,
  OPENPROJECT_ACTIVITY_EVENT_KIND,
} from "./OpenProjectSchema";
import type {
  OpenProjectActiveAnchorContent,
  OpenProjectAnchorContent,
  OpenProjectContent,
  OpenProjectInactiveAnchorContent,
  OpenProjectActivityContent,
} from "./models/OpenProjectMatrixEventContent";

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

function isMatrixUserId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^@[^\s:]+:[^\s:]+$/u.test(value) &&
    value.length <= 255
  );
}

export function isMatrixRoomId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^![^\s:]+:[^\s]+$/u.test(value) &&
    value.length <= 255
  );
}

export function isMatrixEventId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("$") &&
    value.length > 1 &&
    value.length <= 255 &&
    !/[\p{Cc}\p{White_Space}]/u.test(value)
  );
}

function isOpenProjectSnapshotId(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  return (
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

export function isOpenProjectCommandContent(value: unknown): boolean {
  return (
    isOpenProjectCommandRequest(value) || isOpenProjectCommandEventType(value)
  );
}

export function isOpenProjectCommandRequest(value: unknown): boolean {
  if (!isRecord(value) || typeof value.body !== "string") {
    return false;
  }

  return value.body.startsWith("!openproject ");
}

export function isOpenProjectContent(
  value: unknown,
): value is OpenProjectContent {
  if (!isRecord(value)) {
    return false;
  }

  return hasValidWorkPackageId(
    value["org.matrix.matrix-hookshot.openproject.work_package"],
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
  if (!isRecord(value)) {
    return false;
  }

  return (
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
  private readonly inFlightProbes = new Map<
    string,
    Promise<OpenProjectProbeResponse>
  >();
  private lastSessionIdentity: MatrixSessionIdentity | undefined;

  public constructor(private readonly toDeviceClient: HookshotToDeviceClient) {}

  /** Returns the Matrix user and device currently used for capability probes. */
  public getSessionIdentity(): MatrixSessionIdentity {
    return this.toDeviceClient.getSessionIdentity();
  }

  /** Checks whether a capability result still belongs to the active session. */
  public isSessionIdentityCurrent(
    sessionIdentity: MatrixSessionIdentity,
  ): boolean {
    try {
      const currentIdentity = this.toDeviceClient.getSessionIdentity();
      this.observeSession(currentIdentity);
      return (
        currentIdentity.userId === sessionIdentity.userId &&
        currentIdentity.deviceId === sessionIdentity.deviceId
      );
    } catch {
      return false;
    }
  }

  public probe(anchor: OpenProjectAnchor): Promise<OpenProjectProbeResponse> {
    let sessionIdentity: MatrixSessionIdentity;
    try {
      sessionIdentity = this.toDeviceClient.getSessionIdentity();
    } catch (error) {
      return Promise.reject(error);
    }
    this.observeSession(sessionIdentity);

    if (
      !isMatrixRoomId(anchor.roomId) ||
      !isMatrixEventId(anchor.eventId) ||
      !isOpenProjectSnapshotId(anchor.snapshotId) ||
      !Number.isSafeInteger(anchor.workPackageId) ||
      anchor.workPackageId <= 0 ||
      !isMatrixUserId(anchor.recipientUserId)
    ) {
      return Promise.reject(new Error("Invalid OpenProject anchor"));
    }

    const cacheKey = this.createCacheKey(sessionIdentity, anchor);
    const inFlight = this.inFlightProbes.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const request: HookshotToDeviceRequest<OpenProjectProbeResponse> = {
      recipientUserId: anchor.recipientUserId,
      requestType: OPENPROJECT_CAPABILITIES_PROBE_EVENT_TYPE,
      responseType: OPENPROJECT_CAPABILITIES_PROBE_RESPONSE_EVENT_TYPE,
      content: {
        v: HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
        integration_id: OPENPROJECT_INTEGRATION_ID,
        room_id: anchor.roomId,
        anchor_event_id: anchor.eventId,
      },
      responseValidator: (value): value is OpenProjectProbeResponse =>
        isOpenProjectProbeResponse(value, anchor.workPackageId),
    };

    let requestPromise: Promise<OpenProjectProbeResponse>;
    try {
      requestPromise = this.toDeviceClient.request(request);
    } catch (error) {
      requestPromise = Promise.reject(error);
    }

    const probePromise = requestPromise.then((response) => {
      this.assertSessionUnchanged(sessionIdentity);
      return response;
    });
    this.inFlightProbes.set(cacheKey, probePromise);
    void probePromise.then(
      () => this.removeInFlightProbe(cacheKey, probePromise),
      () => this.removeInFlightProbe(cacheKey, probePromise),
    );
    return probePromise;
  }

  private createCacheKey(
    sessionIdentity: MatrixSessionIdentity,
    anchor: OpenProjectAnchor,
  ): string {
    return JSON.stringify([
      sessionIdentity.userId,
      sessionIdentity.deviceId,
      OPENPROJECT_INTEGRATION_ID,
      anchor.recipientUserId,
      anchor.roomId,
      anchor.eventId,
      anchor.snapshotId,
      anchor.workPackageId,
    ]);
  }

  private observeSession(sessionIdentity: MatrixSessionIdentity): void {
    if (
      this.lastSessionIdentity &&
      (this.lastSessionIdentity.userId !== sessionIdentity.userId ||
        this.lastSessionIdentity.deviceId !== sessionIdentity.deviceId)
    ) {
      this.inFlightProbes.clear();
    }
    this.lastSessionIdentity = sessionIdentity;
  }

  private assertSessionUnchanged(
    requestSessionIdentity: MatrixSessionIdentity,
  ): void {
    const currentSessionIdentity = this.toDeviceClient.getSessionIdentity();
    if (
      currentSessionIdentity.userId !== requestSessionIdentity.userId ||
      currentSessionIdentity.deviceId !== requestSessionIdentity.deviceId
    ) {
      this.observeSession(currentSessionIdentity);
      throw new Error("Matrix account changed");
    }
  }

  private removeInFlightProbe(
    key: string,
    promise: Promise<OpenProjectProbeResponse>,
  ): void {
    if (this.inFlightProbes.get(key) === promise) {
      this.inFlightProbes.delete(key);
    }
  }
}
