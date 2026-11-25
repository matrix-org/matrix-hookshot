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
  HOOKSHOT_LOGIN_URL_MAX_LENGTH,
  OPENPROJECT_INTEGRATION_ID,
} from "../utils/config";
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

const TO_DEVICE_REQUEST_TIMEOUT_MS = 10_000;

export { OPENPROJECT_INTEGRATION_ID } from "../utils/config";
export const OPENPROJECT_SNAPSHOT_ID_MAX_LENGTH = 255;
export const HOOKSHOT_CAPABILITIES_PROBE_EVENT_TYPE =
  "org.matrix.matrix-hookshot.capabilities.probe";
export const HOOKSHOT_CAPABILITIES_PROBE_RESPONSE_EVENT_TYPE =
  "org.matrix.matrix-hookshot.capabilities.probe_response";
/** Hookshot to-device event used to begin OpenProject login. */
export const HOOKSHOT_LOGIN_START_EVENT_TYPE =
  "org.matrix.matrix-hookshot.login.start";
/** Hookshot to-device response for a login-start request. */
export const HOOKSHOT_LOGIN_START_RESPONSE_EVENT_TYPE =
  "org.matrix.matrix-hookshot.login.start_response";
/** Hookshot to-device event used to check stored OpenProject login state. */
export const HOOKSHOT_LOGIN_STATUS_EVENT_TYPE =
  "org.matrix.matrix-hookshot.login.status";
/** Hookshot to-device response for a login-status request. */
export const HOOKSHOT_LOGIN_STATUS_RESPONSE_EVENT_TYPE =
  "org.matrix.matrix-hookshot.login.status_response";
export const HOOKSHOT_COMMAND_EVENT_TYPE = "org.matrix.matrix-hookshot.command";
export const HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION = 1;

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
  login?: OpenProjectLoginCapability;
}

/** Login permission advertised by a fresh disconnected capability probe. */
export type OpenProjectLoginCapability =
  | "available"
  | "not_authorized"
  | "unavailable";

/** Strict version 1 response contract for an OpenProject login-start request. */
export type OpenProjectLoginStartResponse =
  | (OpenProjectLoginStartResponseBase & {
      result: "ready";
      auth_url: string;
    })
  | (OpenProjectLoginStartResponseBase & {
      result: "already_connected" | "not_authorized" | "unavailable";
    });

/** Shared correlation fields in a version 1 login-start response. */
export interface OpenProjectLoginStartResponseBase {
  v: typeof HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION;
  request_id: string;
  integration_id: typeof OPENPROJECT_INTEGRATION_ID;
}

/** Strict version 1 response contract for an OpenProject login-status request. */
export interface OpenProjectLoginStatusResponse {
  v: typeof HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION;
  request_id: string;
  integration_id: typeof OPENPROJECT_INTEGRATION_ID;
  result: "connected" | "not_connected" | "unavailable";
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
          "login",
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
      value.connection === "not_connected") &&
    (value.login === undefined ||
      value.login === "available" ||
      value.login === "not_authorized" ||
      value.login === "unavailable")
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
      return (
        (value.connection === undefined || value.connection === "connected") &&
        value.login === undefined
      );
    }
    if (value.result === "not_connected") {
      return (
        (value.connection === undefined ||
          value.connection === "not_connected") &&
        value.actions === undefined
      );
    }
    return (
      value.connection === undefined &&
      value.actions === undefined &&
      value.login === undefined
    );
  }
  return false;
}

/** Validates a version 1 login-start response, including its result-specific fields. */
export function isOpenProjectLoginStartResponse(
  value: unknown,
): value is OpenProjectLoginStartResponse {
  if (
    !isRecord(value) ||
    Object.keys(value).some(
      (key) =>
        !["v", "request_id", "integration_id", "result", "auth_url"].includes(
          key,
        ),
    ) ||
    !isLoginResponseBase(value)
  ) {
    return false;
  }

  if (value.result === "ready") {
    return (
      typeof value.auth_url === "string" &&
      value.auth_url.length > 0 &&
      value.auth_url.length <= HOOKSHOT_LOGIN_URL_MAX_LENGTH
    );
  }
  return (
    (value.result === "already_connected" ||
      value.result === "not_authorized" ||
      value.result === "unavailable") &&
    !Object.prototype.hasOwnProperty.call(value, "auth_url")
  );
}

/** Validates a version 1 login-status response with no unexpected fields. */
export function isOpenProjectLoginStatusResponse(
  value: unknown,
): value is OpenProjectLoginStatusResponse {
  return (
    isRecord(value) &&
    Object.keys(value).every((key) =>
      ["v", "request_id", "integration_id", "result"].includes(key),
    ) &&
    isLoginResponseBase(value) &&
    (value.result === "connected" ||
      value.result === "not_connected" ||
      value.result === "unavailable")
  );
}

function isLoginResponseBase(
  value: JsonRecord,
): value is JsonRecord & OpenProjectLoginStartResponseBase {
  return (
    value.v === HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION &&
    typeof value.request_id === "string" &&
    value.request_id.length > 0 &&
    value.request_id.length <= 255 &&
    !/[\p{Cc}\p{White_Space}]/u.test(value.request_id) &&
    value.integration_id === OPENPROJECT_INTEGRATION_ID
  );
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

  /** Requests a fresh OpenProject authorization URL for the selected anchor. */
  public loginStart(
    anchor: OpenProjectAnchor,
  ): Promise<OpenProjectLoginStartResponse> {
    return this.requestLoginResponse(
      anchor,
      HOOKSHOT_LOGIN_START_EVENT_TYPE,
      HOOKSHOT_LOGIN_START_RESPONSE_EVENT_TYPE,
      isOpenProjectLoginStartResponse,
    );
  }

  /** Checks whether the selected anchor's Matrix user has a stored token. */
  public loginStatus(
    anchor: OpenProjectAnchor,
  ): Promise<OpenProjectLoginStatusResponse> {
    return this.requestLoginResponse(
      anchor,
      HOOKSHOT_LOGIN_STATUS_EVENT_TYPE,
      HOOKSHOT_LOGIN_STATUS_RESPONSE_EVENT_TYPE,
      isOpenProjectLoginStatusResponse,
    );
  }

  private requestLoginResponse<T extends CorrelatedResponse>(
    anchor: OpenProjectAnchor,
    requestType: string,
    responseType: string,
    isResponse: ResponseValidator<T>,
  ): Promise<T> {
    if (!this.isValidAnchor(anchor)) {
      return Promise.reject(new Error("Invalid OpenProject anchor"));
    }

    const identity = this.profile.capture();
    if (!identity) {
      return Promise.reject(new Error("No active Matrix user and device"));
    }

    let requestId: string;
    try {
      requestId = createRequestId();
    } catch (error) {
      return Promise.reject(error);
    }
    return this.sendAndWaitForResponse(
      anchor,
      identity,
      requestId,
      requestType,
      responseType,
      isResponse,
    );
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

    void this.sendAndWaitForResponse(
      anchor,
      identity,
      requestId,
      HOOKSHOT_CAPABILITIES_PROBE_EVENT_TYPE,
      HOOKSHOT_CAPABILITIES_PROBE_RESPONSE_EVENT_TYPE,
      (value): value is OpenProjectProbeResponse =>
        isOpenProjectProbeResponse(value, anchor.workPackageId),
    ).then(
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

  private async sendAndWaitForResponse<T extends CorrelatedResponse>(
    anchor: OpenProjectAnchor,
    identity: ProfileIdentity,
    requestId: string,
    requestType: string,
    responseType: string,
    isResponse: ResponseValidator<T>,
  ): Promise<T> {
    const waiter = this.createResponseWaiter(
      anchor,
      identity,
      requestId,
      responseType,
      isResponse,
    );

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
          type: requestType,
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
      const requestError =
        error instanceof Error
          ? error
          : new Error("OpenProject to-device request failed");
      waiter.cancel(requestError);
      throw requestError;
    }
  }

  private createResponseWaiter<T extends CorrelatedResponse>(
    anchor: OpenProjectAnchor,
    identity: ProfileIdentity,
    requestId: string,
    responseType: string,
    isResponse: ResponseValidator<T>,
  ): ResponseWaiter<T> {
    let resolveResponse!: (response: T) => void;
    let rejectResponse!: (error: Error) => void;
    const promise = new Promise<T>((resolve, reject) => {
      resolveResponse = resolve;
      rejectResponse = reject;
    });
    let settled = false;
    let unsubscribeMessage = (): void => {};
    let unsubscribeProfile = (): void => {};
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const finish = (error: Error | undefined, response?: T): void => {
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

    const waiter: ResponseWaiter<T> = {
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
        responseType,
        (message) => {
          if (!this.profile.isCurrent(identity)) {
            finish(new Error("Matrix account or device changed"));
            return;
          }
          if (
            message.type !== responseType ||
            message.sender !== anchor.recipientUserId ||
            !isResponse(message.content) ||
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
        () => finish(new Error("OpenProject to-device request timed out")),
        TO_DEVICE_REQUEST_TIMEOUT_MS,
      );
      if (!this.profile.isCurrent(identity)) {
        finish(new Error("Matrix account or device changed"));
      }
    } catch (error) {
      finish(
        error instanceof Error
          ? error
          : new Error("OpenProject to-device request failed"),
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

interface CorrelatedResponse {
  readonly request_id: string;
}

type ResponseValidator<T extends CorrelatedResponse> = (
  value: unknown,
) => value is T;

interface ResponseWaiter<T extends CorrelatedResponse> {
  readonly promise: Promise<T>;
  readonly cancel: (error: Error) => void;
  readonly isPending: () => boolean;
}
