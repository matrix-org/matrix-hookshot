import {
  OPENPROJECT_ANCHOR_EVENT_KIND,
  OPENPROJECT_EVENT_SCHEMA_VERSION,
} from "./OpenProjectSchema";
import type { OpenProjectAnchorContent } from "./models/OpenProjectMatrixEventContent";

export const OPENPROJECT_INTEGRATION_ID = "openproject";
export const OPENPROJECT_CAPABILITIES_PROBE_EVENT_TYPE =
  "org.matrix.matrix-hookshot.capabilities.probe";
export const OPENPROJECT_CAPABILITIES_PROBE_RESPONSE_EVENT_TYPE =
  "org.matrix.matrix-hookshot.capabilities.probe_response";
export const HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION = 1;

export type OpenProjectProbeResult =
  | "ok"
  | "not_connected"
  | "not_authorized"
  | "unavailable";

export interface OpenProjectAnchor {
  readonly roomId: string;
  readonly eventId: string;
  readonly workPackageId: number;
  readonly recipientUserId: string;
}

export interface OpenProjectProbeResponse {
  v: typeof HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION;
  request_id: string;
  integration_id: typeof OPENPROJECT_INTEGRATION_ID;
  result: OpenProjectProbeResult;
  connection?: "connected" | "not_connected";
}

export interface OpenProjectProbeOptions {
  readonly force?: boolean;
}

// Matches the pending Element Module API contract. Use its exported types when released.
interface ToDeviceRequest {
  readonly recipientUserId: string;
  readonly requestType: string;
  readonly responseType: string;
  readonly content: Record<string, unknown>;
  readonly timeoutMs?: number;
}

export interface ToDeviceApi {
  request(request: ToDeviceRequest): Promise<unknown>;
}

interface JsonRecord {
  [key: string]: unknown;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMatrixUserId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^@[^\s:]+:[^\s:]+$/u.test(value) &&
    value.length <= 255
  );
}

function isMatrixRoomId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^![^\s:]+:[^\s:]+$/u.test(value) &&
    value.length <= 255
  );
}

function isMatrixEventId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("$") &&
    value.length > 1 &&
    value.length <= 255 &&
    !/[\p{Cc}\p{White_Space}]/u.test(value)
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
      OPENPROJECT_ANCHOR_EVENT_KIND
  );
}

export function isOpenProjectProbeResponse(
  value: unknown,
): value is OpenProjectProbeResponse {
  if (!isRecord(value)) {
    return false;
  }

  return (
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
): content is OpenProjectAnchorContent {
  return (
    botUserId !== undefined &&
    sender === botUserId &&
    isOpenProjectAnchorContent(content)
  );
}

export class OpenProjectCapabilityClient {
  // Completed results cannot be reused safely without a session lifecycle API.
  private readonly pendingProbes = new Map<string, PendingProbeEntry>();

  public constructor(private readonly toDeviceClient: ToDeviceApi) {}

  public probe(
    anchor: OpenProjectAnchor,
    options: OpenProjectProbeOptions = {},
  ): Promise<OpenProjectProbeResponse> {
    if (
      !isMatrixRoomId(anchor.roomId) ||
      !isMatrixEventId(anchor.eventId) ||
      !Number.isSafeInteger(anchor.workPackageId) ||
      anchor.workPackageId <= 0 ||
      !isMatrixUserId(anchor.recipientUserId)
    ) {
      return Promise.reject(new Error("Invalid OpenProject anchor"));
    }

    const probeKey = this.createProbeKey(anchor);
    if (!options.force) {
      const pending = this.pendingProbes.get(probeKey);
      if (pending) {
        return pending.promise;
      }
    }

    const request: ToDeviceRequest = {
      recipientUserId: anchor.recipientUserId,
      requestType: OPENPROJECT_CAPABILITIES_PROBE_EVENT_TYPE,
      responseType: OPENPROJECT_CAPABILITIES_PROBE_RESPONSE_EVENT_TYPE,
      content: {
        v: HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
        integration_id: OPENPROJECT_INTEGRATION_ID,
        room_id: anchor.roomId,
        anchor_event_id: anchor.eventId,
      },
    };

    let requestPromise: Promise<unknown>;
    try {
      requestPromise = this.toDeviceClient.request(request);
    } catch (error) {
      requestPromise = Promise.reject(error);
    }

    const entry: PendingProbeEntry = {
      promise: requestPromise
        .then((response) => {
          if (!isOpenProjectProbeResponse(response)) {
            throw new Error("Invalid OpenProject capability response");
          }
          this.removePendingProbe(probeKey, entry);
          return response;
        })
        .catch((error) => {
          this.removePendingProbe(probeKey, entry);
          throw error;
        }),
    };

    this.pendingProbes.set(probeKey, entry);
    return entry.promise;
  }

  private createProbeKey(anchor: OpenProjectAnchor): string {
    return JSON.stringify([
      OPENPROJECT_INTEGRATION_ID,
      anchor.recipientUserId,
      anchor.roomId,
      anchor.eventId,
      anchor.workPackageId,
    ]);
  }

  private removePendingProbe(probeKey: string, entry: PendingProbeEntry): void {
    if (this.pendingProbes.get(probeKey) === entry) {
      this.pendingProbes.delete(probeKey);
    }
  }
}

interface PendingProbeEntry {
  readonly promise: Promise<OpenProjectProbeResponse>;
}
