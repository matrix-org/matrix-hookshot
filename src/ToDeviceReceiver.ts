import { Appservice, type IAppserviceToDeviceEvent } from "matrix-bot-sdk";
import { Logger } from "matrix-appservice-bridge";
import QuickLRU from "@alloc/quick-lru";

import {
  HOOKSHOT_CAPABILITIES_PROBE_EVENT_TYPE,
  HOOKSHOT_CAPABILITIES_PROBE_RESPONSE_EVENT_TYPE,
  HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
  HookshotCapabilitiesProbeRequest,
  HookshotCapabilitiesProbeResponse,
  HookshotIntegrationId,
  isHookshotCapabilitiesProbeRequest,
  isMatrixUserId,
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
  probeHandler?: HookshotProbeHandler;
}

/**
 * Receives the transport-level Hookshot capability probe over the appservice
 * SDK's dedicated appservice to-device event stream.
 *
 * This class deliberately does not perform room, anchor, authorization, or
 * integration-connection checks. Those belong to the integration dispatcher.
 */
export class HookshotToDeviceReceiver {
  private readonly deduplication: QuickLRU<string, void>;
  private readonly probeHandler?: HookshotProbeHandler;
  private started = false;

  private readonly onToDeviceEvent = (
    event: IAppserviceToDeviceEvent<unknown>,
  ): void => {
    void this.handleToDeviceEvent(event).catch((error) => {
      // A failed probe must not break the appservice event emitter.
      const request = event.content;
      if (isHookshotCapabilitiesProbeRequest(request)) {
        log.error(
          `Failed to handle to-device probe ${request.request_id} for integration ${request.integration_id} on bot ${event.to_user_id}`,
          error,
        );
      } else {
        log.error("Failed to handle a Hookshot to-device event", error);
      }
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
    const deduplicationTtlMs =
      options.deduplicationTtlMs ?? DEFAULT_DEDUPLICATION_TTL_MS;
    const maxDeduplicationEntries =
      options.maxDeduplicationEntries ?? DEFAULT_MAX_DEDUPLICATION_ENTRIES;
    this.probeHandler = options.probeHandler;

    if (deduplicationTtlMs <= 0) {
      throw new Error("deduplicationTtlMs must be positive");
    }
    if (maxDeduplicationEntries <= 0) {
      throw new Error("maxDeduplicationEntries must be positive");
    }
    this.deduplication = new QuickLRU({
      maxAge: deduplicationTtlMs,
      maxSize: maxDeduplicationEntries,
    });
  }

  public start(): void {
    if (this.started) {
      return;
    }

    this.started = true;
    this.appservice.on("to-device", this.onToDeviceEvent);
  }

  public stop(): void {
    if (!this.started) {
      return;
    }

    this.started = false;
    this.appservice.off("to-device", this.onToDeviceEvent);
    this.deduplication.clear();
  }

  /** Exposed for deterministic unit tests; production delivery uses start(). */
  public async handleToDeviceEvent(
    event: IAppserviceToDeviceEvent<unknown>,
  ): Promise<void> {
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

    const deduplicationKey = `${event.sender}\u0000${request.integration_id}\u0000${request.request_id}`;
    if (this.deduplication.has(deduplicationKey)) {
      log.debug(
        "Ignoring duplicate to-device probe request_id=" + request.request_id,
      );
      return;
    }

    this.deduplication.set(deduplicationKey);
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
}
