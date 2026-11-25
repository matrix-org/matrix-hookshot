import {
  HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
  type HookshotCapabilitiesProbeResponse,
  type HookshotCapabilityAction,
  type HookshotIntegrationId,
  type HookshotLoginStartResponse,
  type HookshotLoginStatusResponse,
} from "../../src/ToDeviceProtocol";

const CAPABILITIES_RESPONSE_KEYS = [
  "v",
  "request_id",
  "integration_id",
  "result",
  "connection",
  "actions",
] as const;
const LOGIN_START_RESPONSE_KEYS = [
  "v",
  "request_id",
  "integration_id",
  "result",
  "auth_url",
] as const;
const LOGIN_STATUS_RESPONSE_KEYS = [
  "v",
  "request_id",
  "integration_id",
  "result",
] as const;
const ACTION_KEYS = ["id", "label", "command"] as const;

export function isHookshotCapabilitiesProbeResponse(
  value: unknown,
): value is HookshotCapabilitiesProbeResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, CAPABILITIES_RESPONSE_KEYS)) {
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

export function isHookshotLoginStartResponse(
  value: unknown,
): value is HookshotLoginStartResponse {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, LOGIN_START_RESPONSE_KEYS) ||
    value.v !== HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION ||
    !isNonEmptyString(value.request_id) ||
    !isIntegrationId(value.integration_id)
  ) {
    return false;
  }

  if (value.result === "ready") {
    return value.auth_url === undefined ? false : isAuthUrl(value.auth_url);
  }

  return (
    (value.result === "already_connected" ||
      value.result === "not_authorized" ||
      value.result === "unavailable") &&
    value.auth_url === undefined
  );
}

export function isHookshotLoginStatusResponse(
  value: unknown,
): value is HookshotLoginStatusResponse {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, LOGIN_STATUS_RESPONSE_KEYS) &&
    value.v === HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION &&
    isNonEmptyString(value.request_id) &&
    isIntegrationId(value.integration_id) &&
    (value.result === "connected" ||
      value.result === "not_connected" ||
      value.result === "unavailable")
  );
}

interface RecordValue {
  [key: string]: unknown;
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: RecordValue, keys: readonly string[]): boolean {
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

function isIntegrationId(value: unknown): value is HookshotIntegrationId {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 64 &&
    /^[a-z][a-z0-9_-]*$/u.test(value)
  );
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

function isAuthUrl(value: unknown): value is string {
  if (!isNonEmptyString(value, 2048)) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
