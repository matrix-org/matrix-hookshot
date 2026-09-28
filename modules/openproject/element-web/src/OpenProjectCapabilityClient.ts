import {
  HookshotToDeviceClient,
  type HookshotToDeviceRequest,
} from "./HookshotToDeviceClient";

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
  roomId: string;
  eventId: string;
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

// Temporary probe lifecycle tracing. Remove once request flow debugging is complete.
const PROBE_TRACE = "[OpenProjectCapabilityClient]";

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

export function isOpenProjectAnchorContent(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value["org.matrix.matrix-hookshot.openproject.schema_version"] ===
      HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION &&
    value["org.matrix.matrix-hookshot.openproject.event_kind"] === "anchor"
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
): boolean {
  return (
    botUserId !== undefined &&
    sender === botUserId &&
    isOpenProjectAnchorContent(content)
  );
}

export class OpenProjectCapabilityClient {
  private readonly probeCache = new Map<
    string,
    Promise<OpenProjectProbeResponse>
  >();

  public constructor(
    private readonly toDeviceClient: HookshotToDeviceClient,
    private readonly botUserId: string,
  ) {}

  public probe(
    anchor: OpenProjectAnchor,
    options: OpenProjectProbeOptions = {},
  ): Promise<OpenProjectProbeResponse> {
    console.log(`${PROBE_TRACE} probe requested`, {
      anchor,
      force: options.force === true,
    });

    if (!isMatrixRoomId(anchor.roomId) || !isMatrixEventId(anchor.eventId)) {
      console.log(`${PROBE_TRACE} probe discarded: invalid anchor`, { anchor });
      return Promise.reject(new Error("Invalid OpenProject anchor"));
    }

    const cacheKey = `${anchor.roomId}\u0000${anchor.eventId}`;
    if (!options.force) {
      const cachedProbe = this.probeCache.get(cacheKey);
      if (cachedProbe) {
        console.log(
          `${PROBE_TRACE} probe discarded: reusing cached/in-flight request`,
          { anchor },
        );
        return cachedProbe;
      }
    } else if (this.probeCache.has(cacheKey)) {
      console.log(`${PROBE_TRACE} forcing a new probe`, { anchor });
    }

    const request: HookshotToDeviceRequest<OpenProjectProbeResponse> = {
      recipientUserId: this.botUserId,
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

    console.log(`${PROBE_TRACE} probe sent`, {
      anchor,
      requestType: request.requestType,
      responseType: request.responseType,
    });

    const probe = this.toDeviceClient
      .request(request)
      .then((response) => {
        console.log(`${PROBE_TRACE} probe answer`, {
          anchor,
          requestId: response.request_id,
          result: response.result,
        });
        return response;
      })
      .catch((error) => {
        console.log(`${PROBE_TRACE} probe failed`, { anchor, error });
        // A failed request must not prevent a later explicit retry.
        if (this.probeCache.get(cacheKey) === probe) {
          this.probeCache.delete(cacheKey);
        }
        throw error;
      });

    this.probeCache.set(cacheKey, probe);
    return probe;
  }
}
