export const HOOKSHOT_CAPABILITIES_PROBE_EVENT_TYPE =
  "org.matrix.matrix-hookshot.capabilities.probe";
export const HOOKSHOT_CAPABILITIES_PROBE_RESPONSE_EVENT_TYPE =
  "org.matrix.matrix-hookshot.capabilities.probe_response";

export const HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION = 1;

const HOOKSHOT_EVENT_NAMESPACE = "org.matrix.matrix-hookshot";

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
  actions?: HookshotCapabilityAction[];
}

export interface HookshotCapabilityAction {
  id: string;
  label: string;
  command: string;
}

/** Annotation added by matrix-bot-sdk to events received from a to-device EDU. */
export const MATRIX_BOT_SDK_EDU_ANNOTATION = "io.t2bot.sdk.bot.type";
export const MATRIX_BOT_SDK_TO_DEVICE_ANNOTATION = "to_device";

export interface HookshotToDeviceEvent {
  type?: unknown;
  sender?: unknown;
  content?: unknown;
  to_user_id?: unknown;
  unsigned?: unknown;
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
  "actions",
] as const;

const ACTION_KEYS = ["id", "label", "command"] as const;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isMatrixUserId(value: unknown): value is string {
  return typeof value === "string" && /^@[^:\s]+:[^\s]+$/u.test(value);
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

export function isToDeviceEvent(
  event: unknown,
): event is HookshotToDeviceEvent {
  if (!isRecord(event) || !isRecord(event.unsigned)) {
    return false;
  }

  return (
    event.unsigned[MATRIX_BOT_SDK_EDU_ANNOTATION] ===
    MATRIX_BOT_SDK_TO_DEVICE_ANNOTATION
  );
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

export function isHookshotCapabilitiesProbeResponse(
  value: unknown,
): value is HookshotCapabilitiesProbeResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, RESPONSE_KEYS)) {
    return false;
  }

  const connection = value.connection;
  if (
    value.v !== HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION ||
    !isNonEmptyString(value.request_id) ||
    !isIntegrationId(value.integration_id) ||
    !(
      value.result === "ok" ||
      value.result === "not_connected" ||
      value.result === "not_authorized" ||
      value.result === "unavailable"
    ) ||
    !(
      connection === undefined ||
      connection === "connected" ||
      connection === "not_connected"
    )
  ) {
    return false;
  }

  if (value.actions !== undefined) {
    if (
      value.result !== "ok" ||
      connection !== "connected" ||
      !Array.isArray(value.actions) ||
      value.actions.length > 16 ||
      !value.actions.every(isHookshotCapabilityAction)
    ) {
      return false;
    }
    const ids = value.actions.map((action) => action.id);
    if (new Set(ids).size !== ids.length) {
      return false;
    }
  }

  if (value.result === "ok") {
    return connection === undefined || connection === "connected";
  }
  if (value.result === "not_connected") {
    return (
      (connection === undefined || connection === "not_connected") &&
      value.actions === undefined
    );
  }
  return connection === undefined && value.actions === undefined;
}

function isHookshotCapabilityAction(
  value: unknown,
): value is HookshotCapabilityAction {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ACTION_KEYS) &&
    isCapabilityActionId(value.id) &&
    isBoundedText(value.label, 100) &&
    isBoundedText(value.command, 512)
  );
}

function isCapabilityActionId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    /^[a-z][a-z0-9_-]*$/u.test(value)
  );
}

function isBoundedText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxLength &&
    !/[\p{Cc}]/u.test(value)
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
