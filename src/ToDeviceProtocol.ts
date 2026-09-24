
export const HOOKSHOT_CAPABILITIES_PROBE_EVENT_TYPE =
  "org.matrix.matrix-hookshot.capabilities.probe";
export const HOOKSHOT_CAPABILITIES_PROBE_RESPONSE_EVENT_TYPE =
  "org.matrix.matrix-hookshot.capabilities.probe_response";

export const HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION = 1;

const HOOKSHOT_EVENT_NAMESPACE = "org.matrix.matrix-hookshot";
const ANCHOR_EVENT_KIND = "anchor";

export type HookshotIntegrationId = string;

export type HookshotProbeResult =
  | "ok"
  | "not_connected"
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

export interface HookshotCapabilitiesProbeResponse {
  v: typeof HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION;
  request_id: string;
  integration_id: HookshotIntegrationId;
  result: HookshotProbeResult;
  connection?: "connected" | "not_connected";
}

const REQUEST_KEYS = [
  "v",
  "request_id",
  "requesting_device_id",
  "integration_id",
  "room_id",
  "anchor_event_id",
] as const;

const RESPONSE_KEYS = [
  "v",
  "request_id",
  "integration_id",
  "result",
  "connection",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function isMatrixRoomId(value: unknown): value is string {
  return (
    isNonEmptyString(value) && value.startsWith("!") && value.includes(":")
  );
}

function isMatrixEventId(value: unknown): value is string {
  return isNonEmptyString(value) && value.startsWith("$");
}

function isTargetDeviceId(value: unknown): value is string {
  return isNonEmptyString(value) && value !== "*";
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

export function isHookshotCapabilitiesProbeResponse(
  value: unknown,
): value is HookshotCapabilitiesProbeResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, RESPONSE_KEYS)) {
    return false;
  }

  const connection = value.connection;
  return (
    value.v === HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION &&
    isNonEmptyString(value.request_id) &&
    isIntegrationId(value.integration_id) &&
    (value.result === "ok" ||
      value.result === "not_connected" ||
      value.result === "not_authorized" ||
      value.result === "unavailable") &&
    (connection === undefined ||
      connection === "connected" ||
      connection === "not_connected")
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
): boolean {
  if (!isRecord(value) || !isIntegrationId(integrationId)) {
    return false;
  }

  const integrationNamespace = `${HOOKSHOT_EVENT_NAMESPACE}.${integrationId}`;
  return (
    value[`${integrationNamespace}.schema_version`] ===
      HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION &&
    value[`${integrationNamespace}.event_kind`] === ANCHOR_EVENT_KIND
  );
}
