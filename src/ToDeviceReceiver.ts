import { Appservice } from "matrix-bot-sdk";
import { Logger } from "matrix-appservice-bridge";

import {
  HOOKSHOT_CAPABILITIES_PROBE_EVENT_TYPE,
  HOOKSHOT_CAPABILITIES_PROBE_RESPONSE_EVENT_TYPE,
  HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
  HookshotCapabilitiesProbeRequest,
  HookshotCapabilitiesProbeResponse,
  HookshotIntegrationId,
  isHookshotCapabilitiesProbeRequest,
  isMatrixUserId,
  isToDeviceEvent,
} from "./ToDeviceProtocol";

const DEFAULT_DEDUPLICATION_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_DEDUPLICATION_ENTRIES = 10_000;
const log = new Logger("HookshotToDeviceReceiver");

export interface HookshotProbeContext {
  sender: string;
  recipientBotUserId: string;
}

export type HookshotProbeResponseState = Pick<
  HookshotCapabilitiesProbeResponse,
  "result" | "connection"
>;

export type HookshotProbeHandler = (
  request: HookshotCapabilitiesProbeRequest,
  context: HookshotProbeContext,
) => Promise<HookshotProbeResponseState>;

export interface HookshotToDeviceReceiverOptions {
  deduplicationTtlMs?: number;
  maxDeduplicationEntries?: number;
  now?: () => number;
  probeHandler?: HookshotProbeHandler;
}

/**
 * Receives the transport-level Hookshot capability probe over the appservice
 * SDK's ephemeral event stream.
 *
 * This class deliberately does not perform room, anchor, authorization, or
 * integration-connection checks. Those belong to the integration dispatcher.
 */
export class HookshotToDeviceReceiver {
  private readonly deduplication = new Map<string, number>();
  private readonly deduplicationTtlMs: number;
  private readonly maxDeduplicationEntries: number;
  private readonly now: () => number;
  private readonly probeHandler?: HookshotProbeHandler;
  private started = false;

  private readonly onEphemeralEvent = (event: unknown): void => {
    void this.handleEphemeralEvent(event).catch(() => {
      // A failed response must not break the appservice event emitter.
      log.error("Failed to send a Hookshot to-device response");
    });
  };

  constructor(
    private readonly appservice: Appservice,
    private readonly integrationBots: ReadonlyMap<
      HookshotIntegrationId,
      string
    >,
    options: HookshotToDeviceReceiverOptions = {},
  ) {
    this.deduplicationTtlMs =
      options.deduplicationTtlMs ?? DEFAULT_DEDUPLICATION_TTL_MS;
    this.maxDeduplicationEntries =
      options.maxDeduplicationEntries ?? DEFAULT_MAX_DEDUPLICATION_ENTRIES;
    this.now = options.now ?? Date.now;
    this.probeHandler = options.probeHandler;

    if (this.deduplicationTtlMs <= 0) {
      throw new Error("deduplicationTtlMs must be positive");
    }
    if (this.maxDeduplicationEntries <= 0) {
      throw new Error("maxDeduplicationEntries must be positive");
    }
  }

  public start(): void {
    if (this.started) {
      return;
    }

    this.started = true;
    this.appservice.on("ephemeral.event", this.onEphemeralEvent);
  }

  public stop(): void {
    if (!this.started) {
      return;
    }

    this.started = false;
    this.appservice.off("ephemeral.event", this.onEphemeralEvent);
    this.deduplication.clear();
  }

  /** Exposed for deterministic unit tests; production delivery uses start(). */
  public async handleEphemeralEvent(event: unknown): Promise<void> {
    if (!isToDeviceEvent(event)) {
      return;
    }

    log.debug(
      "Received to-device event type=" +
        String(event.type) +
        " from=" +
        String(event.sender) +
        " to=" +
        String(event.to_user_id),
    );

    if (event.type !== HOOKSHOT_CAPABILITIES_PROBE_EVENT_TYPE) {
      return;
    }

    if (!isMatrixUserId(event.sender) || !isMatrixUserId(event.to_user_id)) {
      return;
    }

    const request = event.content;
    if (!isHookshotCapabilitiesProbeRequest(request)) {
      return;
    }

    const expectedBotUserId = this.integrationBots.get(request.integration_id);
    if (!expectedBotUserId || expectedBotUserId !== event.to_user_id) {
      return;
    }

    this.pruneDeduplication();
    const deduplicationKey = `${event.sender}\u0000${request.integration_id}\u0000${request.request_id}`;
    if (this.deduplication.has(deduplicationKey)) {
      log.debug(
        "Ignoring duplicate to-device probe request_id=" + request.request_id,
      );
      return;
    }

    this.remember(deduplicationKey);
    log.debug(
      "Accepted to-device probe integration=" +
        request.integration_id +
        " request_id=" +
        request.request_id,
    );

    const responseState = this.probeHandler
      ? await this.probeHandler(request, {
          sender: event.sender,
          recipientBotUserId: expectedBotUserId,
        })
      : { result: "unavailable" as const };
    const response: HookshotCapabilitiesProbeResponse = {
      v: HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
      request_id: request.request_id,
      integration_id: request.integration_id,
      ...responseState,
    };

    await this.appservice
      .getIntentForUserId(expectedBotUserId)
      .underlyingClient.sendToDevices(
        HOOKSHOT_CAPABILITIES_PROBE_RESPONSE_EVENT_TYPE,
        {
          [event.sender]: {
            [request.requesting_device_id]: response,
          },
        },
      );

    log.debug(
      "Sent to-device response type=" +
        HOOKSHOT_CAPABILITIES_PROBE_RESPONSE_EVENT_TYPE +
        " to=" +
        event.sender +
        " request_id=" +
        request.request_id,
    );
  }

  private pruneDeduplication(): void {
    const expiresAt = this.now();
    for (const [key, expiry] of this.deduplication) {
      if (expiry <= expiresAt) {
        this.deduplication.delete(key);
      }
    }
  }

  private remember(key: string): void {
    this.deduplication.set(key, this.now() + this.deduplicationTtlMs);
    while (this.deduplication.size > this.maxDeduplicationEntries) {
      const oldest = this.deduplication.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.deduplication.delete(oldest);
    }
  }
}
