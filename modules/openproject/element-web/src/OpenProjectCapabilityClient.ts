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
  OPENPROJECT_UPDATE_EVENT_KIND,
} from "./OpenProjectSchema";
import type {
  OpenProjectActiveAnchorContent,
  OpenProjectAnchorContent,
  OpenProjectInactiveAnchorContent,
  OpenProjectUpdateContent,
} from "./models/OpenProjectMatrixEventContent";

export const OPENPROJECT_INTEGRATION_ID = "openproject";
export const OPENPROJECT_CAPABILITIES_PROBE_EVENT_TYPE =
  "org.matrix.matrix-hookshot.capabilities.probe";
export const OPENPROJECT_CAPABILITIES_PROBE_RESPONSE_EVENT_TYPE =
  "org.matrix.matrix-hookshot.capabilities.probe_response";
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

function isOpenProjectSnapshotId(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  return (
    value.trim().length > 0 &&
    value.length <= OPENPROJECT_SNAPSHOT_ID_MAX_LENGTH
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

export function isOpenProjectUpdateContent(
  value: unknown,
): value is OpenProjectUpdateContent {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value["org.matrix.matrix-hookshot.openproject.schema_version"] ===
      OPENPROJECT_EVENT_SCHEMA_VERSION &&
    value["org.matrix.matrix-hookshot.openproject.event_kind"] ===
      OPENPROJECT_UPDATE_EVENT_KIND &&
    hasValidWorkPackageId(
      value["org.matrix.matrix-hookshot.openproject.work_package"],
    )
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
): content is OpenProjectActiveAnchorContent {
  return (
    botUserId !== undefined &&
    sender === botUserId &&
    isOpenProjectActiveAnchorContent(content)
  );
}

export class OpenProjectCapabilityClient {
  private readonly probeCache = new Map<string, ProbeCacheEntry>();
  private lastSessionIdentity: MatrixSessionIdentity | undefined;

  public constructor(private readonly toDeviceClient: HookshotToDeviceClient) {}

  public probe(
    anchor: OpenProjectAnchor,
    options: OpenProjectProbeOptions = {},
  ): Promise<OpenProjectProbeResponse> {
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
      !Number.isSafeInteger(anchor.workPackageId) ||
      anchor.workPackageId <= 0 ||
      !isMatrixUserId(anchor.recipientUserId)
    ) {
      return Promise.reject(new Error("Invalid OpenProject anchor"));
    }

    const cacheKey = this.createCacheKey(sessionIdentity, anchor);
    if (!options.force) {
      const cachedEntry = this.probeCache.get(cacheKey);
      if (cachedEntry) {
        return cachedEntry.promise;
      }
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
      responseValidator: isOpenProjectProbeResponse,
    };

    let requestPromise: Promise<OpenProjectProbeResponse>;
    try {
      requestPromise = this.toDeviceClient.request(request);
    } catch (error) {
      requestPromise = Promise.reject(error);
    }

    const entry: ProbeCacheEntry = {
      promise: requestPromise
        .then((response) => {
          this.assertSessionUnchanged(sessionIdentity);
          if (response.result === "unavailable") {
            this.removeEntry(cacheKey, entry);
          }
          return response;
        })
        .catch((error) => {
          // A failed request must not prevent a later explicit retry.
          this.removeEntry(cacheKey, entry);
          throw error;
        }),
    };

    this.probeCache.set(cacheKey, entry);
    return entry.promise;
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
      anchor.workPackageId,
    ]);
  }

  private observeSession(sessionIdentity: MatrixSessionIdentity): void {
    if (
      this.lastSessionIdentity &&
      (this.lastSessionIdentity.userId !== sessionIdentity.userId ||
        this.lastSessionIdentity.deviceId !== sessionIdentity.deviceId)
    ) {
      this.probeCache.clear();
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

  private removeEntry(cacheKey: string, entry: ProbeCacheEntry): void {
    if (this.probeCache.get(cacheKey) === entry) {
      this.probeCache.delete(cacheKey);
    }
  }
}

interface ProbeCacheEntry {
  readonly promise: Promise<OpenProjectProbeResponse>;
}
