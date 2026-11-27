import { Appservice, type IAppserviceToDeviceEvent } from "matrix-bot-sdk";
import { Logger } from "matrix-appservice-bridge";

import {
  HOOKSHOT_CAPABILITIES_PROBE_EVENT_TYPE,
  HOOKSHOT_CAPABILITIES_PROBE_RESPONSE_EVENT_TYPE,
  HOOKSHOT_LOGIN_START_EVENT_TYPE,
  HOOKSHOT_LOGIN_START_RESPONSE_EVENT_TYPE,
  HOOKSHOT_LOGIN_STATUS_EVENT_TYPE,
  HOOKSHOT_LOGIN_STATUS_RESPONSE_EVENT_TYPE,
  HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
  HookshotCapabilitiesProbeRequest,
  HookshotCapabilitiesProbeResponse,
  HookshotIntegrationId,
  HookshotLoginStartRequest,
  HookshotLoginStartResponse,
  HookshotLoginStartResponseState,
  HookshotLoginStatusRequest,
  HookshotLoginStatusResponse,
  HookshotLoginStatusResponseState,
  isHookshotCapabilitiesProbeRequest,
  isHookshotLoginStartRequest,
  isHookshotLoginStatusRequest,
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
  "result" | "connection" | "actions" | "login"
>;

export type HookshotProbeHandler = (
  request: HookshotCapabilitiesProbeRequest,
  context: HookshotProbeContext,
) => Promise<HookshotProbeResponseState>;

export type HookshotLoginStartHandler = (
  request: HookshotLoginStartRequest,
  context: HookshotProbeContext,
) => Promise<HookshotLoginStartResponseState>;

export type HookshotLoginStatusHandler = (
  request: HookshotLoginStatusRequest,
  context: HookshotProbeContext,
) => Promise<HookshotLoginStatusResponseState>;

/** A deployment-selected bot and the integration's to-device handlers. */
export interface HookshotCapabilityEndpoint {
  botUserId: string;
  probeHandler: HookshotProbeHandler;
  loginStartHandler?: HookshotLoginStartHandler;
  loginStatusHandler?: HookshotLoginStatusHandler;
}

export interface HookshotToDeviceReceiverOptions {
  deduplicationTtlMs?: number;
  maxDeduplicationEntries?: number;
  now?: () => number;
}

/**
 * Receives the transport-level Hookshot capability probe over the appservice
 * SDK's dedicated appservice to-device event stream.
 *
 * This class deliberately does not perform room, anchor, authorization, or
 * integration-connection checks. Those belong to the registered handler.
 */
export class HookshotToDeviceReceiver {
  private readonly deduplication = new Map<string, number>();
  private readonly deduplicationTtlMs: number;
  private readonly maxDeduplicationEntries: number;
  private readonly now: () => number;
  private started = false;

  private readonly onToDeviceEvent = (
    event: IAppserviceToDeviceEvent<unknown>,
  ): void => {
    void this.handleToDeviceEvent(event).catch(() => {
      // A failed response must not break the appservice event emitter.
      log.error("Failed to send a Hookshot to-device response");
    });
  };

  constructor(
    private readonly appservice: Appservice,
    private readonly integrations: ReadonlyMap<
      HookshotIntegrationId,
      HookshotCapabilityEndpoint
    >,
    options: HookshotToDeviceReceiverOptions = {},
  ) {
    this.deduplicationTtlMs =
      options.deduplicationTtlMs ?? DEFAULT_DEDUPLICATION_TTL_MS;
    this.maxDeduplicationEntries =
      options.maxDeduplicationEntries ?? DEFAULT_MAX_DEDUPLICATION_ENTRIES;
    this.now = options.now ?? Date.now;

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

    if (
      event.type !== HOOKSHOT_CAPABILITIES_PROBE_EVENT_TYPE &&
      event.type !== HOOKSHOT_LOGIN_START_EVENT_TYPE &&
      event.type !== HOOKSHOT_LOGIN_STATUS_EVENT_TYPE
    ) {
      return;
    }

    if (!isMatrixUserId(event.sender) || !isMatrixUserId(event.to_user_id)) {
      return;
    }

    switch (event.type) {
      case HOOKSHOT_CAPABILITIES_PROBE_EVENT_TYPE: {
        const request = event.content;
        if (isHookshotCapabilitiesProbeRequest(request)) {
          await this.handleProbeRequest(event, request);
        }
        return;
      }
      case HOOKSHOT_LOGIN_START_EVENT_TYPE: {
        const request = event.content;
        if (isHookshotLoginStartRequest(request)) {
          await this.handleLoginStartRequest(event, request);
        }
        return;
      }
      case HOOKSHOT_LOGIN_STATUS_EVENT_TYPE: {
        const request = event.content;
        if (isHookshotLoginStatusRequest(request)) {
          await this.handleLoginStatusRequest(event, request);
        }
      }
    }
  }

  private async handleProbeRequest(
    event: IAppserviceToDeviceEvent<unknown>,
    request: HookshotCapabilitiesProbeRequest,
  ): Promise<void> {
    const integration = this.getIntegration(
      event.to_user_id,
      request.integration_id,
    );
    if (
      !integration ||
      !this.acceptRequest(
        event.sender,
        request.integration_id,
        request.request_id,
        "probe",
      )
    ) {
      return;
    }
    const responseState = await integration.probeHandler(request, {
      sender: event.sender,
      recipientBotUserId: integration.botUserId,
    });
    const response: HookshotCapabilitiesProbeResponse = {
      v: HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
      request_id: request.request_id,
      integration_id: request.integration_id,
      ...responseState,
    };
    await this.sendResponse(
      integration.botUserId,
      event.sender,
      request.requesting_device_id,
      request.request_id,
      HOOKSHOT_CAPABILITIES_PROBE_RESPONSE_EVENT_TYPE,
      response,
    );
  }

  private async handleLoginStartRequest(
    event: IAppserviceToDeviceEvent<unknown>,
    request: HookshotLoginStartRequest,
  ): Promise<void> {
    const integration = this.getIntegration(
      event.to_user_id,
      request.integration_id,
    );
    if (
      !integration ||
      !this.acceptRequest(
        event.sender,
        request.integration_id,
        request.request_id,
        "login-start",
      )
    ) {
      return;
    }
    const responseState = integration.loginStartHandler
      ? await integration.loginStartHandler(request, {
          sender: event.sender,
          recipientBotUserId: integration.botUserId,
        })
      : { result: "unavailable" as const };
    const response: HookshotLoginStartResponse = {
      v: HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
      request_id: request.request_id,
      integration_id: request.integration_id,
      ...responseState,
    };
    await this.sendResponse(
      integration.botUserId,
      event.sender,
      request.requesting_device_id,
      request.request_id,
      HOOKSHOT_LOGIN_START_RESPONSE_EVENT_TYPE,
      response,
    );
  }

  private async handleLoginStatusRequest(
    event: IAppserviceToDeviceEvent<unknown>,
    request: HookshotLoginStatusRequest,
  ): Promise<void> {
    const integration = this.getIntegration(
      event.to_user_id,
      request.integration_id,
    );
    if (
      !integration ||
      !this.acceptRequest(
        event.sender,
        request.integration_id,
        request.request_id,
        "login-status",
      )
    ) {
      return;
    }
    const responseState = integration.loginStatusHandler
      ? await integration.loginStatusHandler(request, {
          sender: event.sender,
          recipientBotUserId: integration.botUserId,
        })
      : { result: "unavailable" as const };
    const response: HookshotLoginStatusResponse = {
      v: HOOKSHOT_TO_DEVICE_PROTOCOL_VERSION,
      request_id: request.request_id,
      integration_id: request.integration_id,
      ...responseState,
    };
    await this.sendResponse(
      integration.botUserId,
      event.sender,
      request.requesting_device_id,
      request.request_id,
      HOOKSHOT_LOGIN_STATUS_RESPONSE_EVENT_TYPE,
      response,
    );
  }

  private getIntegration(
    toUserId: string,
    integrationId: HookshotIntegrationId,
  ): HookshotCapabilityEndpoint | undefined {
    const integration = this.integrations.get(integrationId);
    return integration?.botUserId === toUserId ? integration : undefined;
  }

  private acceptRequest(
    sender: string,
    integrationId: HookshotIntegrationId,
    requestId: string,
    requestKind: "probe" | "login-start" | "login-status",
  ): boolean {
    this.pruneDeduplication();
    const deduplicationKey = `${sender}\u0000${integrationId}\u0000${requestId}`;
    if (this.deduplication.has(deduplicationKey)) {
      log.debug(
        `Ignoring duplicate to-device ${requestKind} request_id=${requestId}`,
      );
      return false;
    }

    this.remember(deduplicationKey);
    log.debug(
      `Accepted to-device ${requestKind} integration=${integrationId} request_id=${requestId}`,
    );
    return true;
  }

  private async sendResponse(
    botUserId: string,
    sender: string,
    deviceId: string,
    requestId: string,
    responseEventType: string,
    response: unknown,
  ): Promise<void> {
    await this.appservice
      .getIntentForUserId(botUserId)
      .underlyingClient.sendToDevices(responseEventType, {
        [sender]: {
          [deviceId]: response,
        },
      });
    log.debug(
      `Sent to-device response type=${responseEventType} to=${sender} request_id=${requestId}`,
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
