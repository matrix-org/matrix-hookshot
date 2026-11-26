import { MatrixUser } from "matrix-appservice-bridge";

export const HOOKSHOT_CAPABILITIES_PROBE_EVENT_TYPE =
  "org.matrix.matrix-hookshot.capabilities.probe";
export const HOOKSHOT_CAPABILITIES_PROBE_RESPONSE_EVENT_TYPE =
  "org.matrix.matrix-hookshot.capabilities.probe_response";

export const HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION = 1;

const HOOKSHOT_EVENT_NAMESPACE = "org.matrix.matrix-hookshot";

/**
 * Integrations currently supported by the to-device protocol.
 * Other {@link ConnectionType} values can be added as they implement it.
 */
export const HOOKSHOT_INTEGRATION_IDS = ["openproject"] as const;

/** Identifies the integration that owns an event and selects its bot. */
export type HookshotIntegrationId = (typeof HOOKSHOT_INTEGRATION_IDS)[number];

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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isMatrixUserId(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith("@")) {
    return false;
  }

  // MatrixUser parses IDs but does not validate them; do not escape the input.
  const user = new MatrixUser(value, {}, false);
  return !!user.localpart && !!user.host && !/\s/u.test(value);
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

export function isHookshotIntegrationId(
  value: unknown,
): value is HookshotIntegrationId {
  return (
    typeof value === "string" &&
    HOOKSHOT_INTEGRATION_IDS.some((id) => id === value)
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
    isHookshotIntegrationId(value.integration_id) &&
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
    isHookshotIntegrationId(value.integration_id) &&
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
  expectedSchemaVersion: number,
  expectedEventKind: string,
): boolean {
  if (!isRecord(value) || !isHookshotIntegrationId(integrationId)) {
    return false;
  }

  const integrationNamespace = `${HOOKSHOT_EVENT_NAMESPACE}.${integrationId}`;
  return (
    value[`${integrationNamespace}.schema_version`] === expectedSchemaVersion &&
    value[`${integrationNamespace}.event_kind`] === expectedEventKind
  );
}
