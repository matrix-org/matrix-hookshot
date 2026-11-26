export const HOOKSHOT_CAPABILITIES_PROBE_EVENT_TYPE =
  "org.matrix.matrix-hookshot.capabilities.probe";
export const HOOKSHOT_CAPABILITIES_PROBE_RESPONSE_EVENT_TYPE =
  "org.matrix.matrix-hookshot.capabilities.probe_response";
export const HOOKSHOT_LOGIN_START_EVENT_TYPE =
  "org.matrix.matrix-hookshot.login.start";
export const HOOKSHOT_LOGIN_START_RESPONSE_EVENT_TYPE =
  "org.matrix.matrix-hookshot.login.start_response";
export const HOOKSHOT_LOGIN_STATUS_EVENT_TYPE =
  "org.matrix.matrix-hookshot.login.status";
export const HOOKSHOT_LOGIN_STATUS_RESPONSE_EVENT_TYPE =
  "org.matrix.matrix-hookshot.login.status_response";

export const HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION = 1;

const HOOKSHOT_EVENT_NAMESPACE = "org.matrix.matrix-hookshot";

export type HookshotIntegrationId = string;

export type HookshotProbeResult =
  | "ok"
  | "not_connected"
  | "not_authorized"
  | "unavailable";

export type HookshotLoginStartResult =
  | "ready"
  | "already_connected"
  | "not_authorized"
  | "unavailable";

export type HookshotLoginStatusResult =
  | "connected"
  | "not_connected"
  | "unavailable";

export type HookshotLoginCapability =
  | "available"
  | "not_authorized"
  | "unavailable";

export interface HookshotCapabilitiesProbeRequest {
  v: typeof HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION;
  request_id: string;
  requesting_device_id: string;
  integration_id: HookshotIntegrationId;
  room_id: string;
  anchor_event_id: string;
}

export interface HookshotLoginStartRequest {
  v: typeof HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION;
  request_id: string;
  requesting_device_id: string;
  integration_id: HookshotIntegrationId;
  room_id: string;
  anchor_event_id: string;
}

export interface HookshotLoginStartResponseBase {
  v: typeof HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION;
  request_id: string;
  integration_id: HookshotIntegrationId;
}

export type HookshotLoginStartResponse =
  | (HookshotLoginStartResponseBase & {
      result: "ready";
      auth_url: string;
    })
  | (HookshotLoginStartResponseBase & {
      result: Exclude<HookshotLoginStartResult, "ready">;
    });

export type HookshotLoginStartResponseState =
  | { result: "ready"; auth_url: string }
  | {
      result: Exclude<HookshotLoginStartResult, "ready">;
    };

export interface HookshotLoginStatusRequest {
  v: typeof HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION;
  request_id: string;
  requesting_device_id: string;
  integration_id: HookshotIntegrationId;
  room_id: string;
  anchor_event_id: string;
}

export interface HookshotLoginStatusResponse {
  v: typeof HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION;
  request_id: string;
  integration_id: HookshotIntegrationId;
  result: HookshotLoginStatusResult;
}

export type HookshotLoginStatusResponseState = Pick<
  HookshotLoginStatusResponse,
  "result"
>;

export interface HookshotCapabilitiesProbeResponse {
  v: typeof HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION;
  request_id: string;
  integration_id: HookshotIntegrationId;
  result: HookshotProbeResult;
  connection?: "connected" | "not_connected";
  actions?: HookshotCapabilityAction[];
  login?: HookshotLoginCapability;
}

export interface HookshotCapabilityAction {
  id: string;
  label: string;
  command: string;
}

const REQUEST_KEYS = [
  "v",
  "request_id",
  "requesting_device_id",
  "integration_id",
  "room_id",
  "anchor_event_id",
] as const;

const LOGIN_START_REQUEST_KEYS = REQUEST_KEYS;
const LOGIN_STATUS_REQUEST_KEYS = REQUEST_KEYS;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isMatrixUserId(value: unknown): value is string {
  return typeof value === "string" && /^@[^:\s]+:[^\s]+$/u.test(value);
}

function isMatrixRoomId(value: unknown): value is string {
  return isNonEmptyString(value) && value.startsWith("!");
}

function isMatrixEventId(value: unknown): value is string {
  return isNonEmptyString(value) && value.startsWith("$");
}

function isTargetDeviceId(value: unknown): value is string {
  return isNonEmptyString(value) && value !== "*";
}

function isIntegrationId(value: unknown): value is HookshotIntegrationId {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 64 &&
    /^[a-z][a-z0-9_-]*$/u.test(value)
  );
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isNonEmptyString(value: unknown, maxLength = 255): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    !/[\p{Cc}\p{White_Space}]/u.test(value)
  );
}

export function isHookshotCapabilitiesProbeRequest(
  value: unknown,
): value is HookshotCapabilitiesProbeRequest {
  if (!isRecord(value) || !hasOnlyKeys(value, REQUEST_KEYS)) {
    return false;
  }

  return (
    value.v === HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION &&
    isNonEmptyString(value.request_id) &&
    isTargetDeviceId(value.requesting_device_id) &&
    isIntegrationId(value.integration_id) &&
    isMatrixRoomId(value.room_id) &&
    isMatrixEventId(value.anchor_event_id)
  );
}

export function isHookshotLoginStartRequest(
  value: unknown,
): value is HookshotLoginStartRequest {
  return isLoginContextRequest(value, LOGIN_START_REQUEST_KEYS);
}

export function isHookshotLoginStatusRequest(
  value: unknown,
): value is HookshotLoginStatusRequest {
  return isLoginContextRequest(value, LOGIN_STATUS_REQUEST_KEYS);
}

function isLoginContextRequest(
  value: unknown,
  keys: readonly string[],
): value is HookshotLoginStartRequest | HookshotLoginStatusRequest {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, keys) &&
    value.v === HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION &&
    isNonEmptyString(value.request_id) &&
    isTargetDeviceId(value.requesting_device_id) &&
    isIntegrationId(value.integration_id) &&
    isMatrixRoomId(value.room_id) &&
    isMatrixEventId(value.anchor_event_id)
  );
}

/**
 * Check the integration-specific anchor marker without selecting or
 * dispatching an integration. The receiver must first map the request's
 * integration_id to a deployment-configured integration handler.
 */
export function isVersionedHookshotAnchorEventContent(
  value: unknown,
  integrationId: HookshotIntegrationId,
  expectedSchemaVersion: number,
  expectedEventKind: string,
): boolean {
  if (!isRecord(value) || !isIntegrationId(integrationId)) {
    return false;
  }

  const integrationNamespace = `${HOOKSHOT_EVENT_NAMESPACE}.${integrationId}`;
  return (
    value[`${integrationNamespace}.schema_version`] === expectedSchemaVersion &&
    value[`${integrationNamespace}.event_kind`] === expectedEventKind
  );
}
