const DEFAULT_TIMEOUT_MS = 10_000;
const TO_DEVICE_EVENT_NAME = "toDeviceEvent";

export interface HookshotToDeviceRequest<TResponse = unknown> {
  recipientUserId: string;
  requestType: string;
  responseType: string;
  content: Record<string, unknown>;
  timeoutMs?: number;
  responseValidator?: (content: unknown) => content is TResponse;
}

export interface HookshotToDeviceClientOptions {
  timeoutMs?: number;
  requestIdGenerator?: () => string;
}

export interface MatrixToDeviceEvent {
  getType(): string;
  getSender(): string | null;
  getContent(): unknown;
  getUnsigned?(): unknown;
}

export interface ElementMatrixClient {
  getUserId(): string | null;
  getDeviceId(): string | null;
  sendToDevice(
    eventType: string,
    contentMap: Map<string, Map<string, Record<string, unknown>>>,
    txnId?: string,
  ): Promise<unknown>;
  on(
    eventName: typeof TO_DEVICE_EVENT_NAME,
    listener: (event: MatrixToDeviceEvent) => void,
  ): void;
  off(
    eventName: typeof TO_DEVICE_EVENT_NAME,
    listener: (event: MatrixToDeviceEvent) => void,
  ): void;
}

export interface MatrixSessionIdentity {
  readonly userId: string;
  readonly deviceId: string;
}

declare global {
  interface Window {
    /**
     * Temporary proof-of-concept access.
     * Replace with the supported Element Module API when available.
     */
    mxMatrixClientPeg?: {
      safeGet(): ElementMatrixClient | null;
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  throw new Error("Secure request ID generation is unavailable");
}

function getTargetDeviceId(event: MatrixToDeviceEvent): string | undefined {
  const unsigned = event.getUnsigned?.();
  if (!isRecord(unsigned) || typeof unsigned.device_id !== "string") {
    return undefined;
  }
  return unsigned.device_id;
}

function getSessionIdentityForClient(
  matrixClient: ElementMatrixClient,
): MatrixSessionIdentity {
  const userId = matrixClient.getUserId();
  const deviceId = matrixClient.getDeviceId();
  if (!userId || !deviceId) {
    throw new Error("The Matrix client has no session identity");
  }

  return Object.freeze({ userId, deviceId });
}

/**
 * Matrix to-device adapter for the Element module.
 */
export class HookshotToDeviceClient {
  private readonly timeoutMs: number;
  private readonly requestIdGenerator: () => string;

  public constructor(options: HookshotToDeviceClientOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.requestIdGenerator = options.requestIdGenerator ?? createRequestId;

    if (this.timeoutMs <= 0) {
      throw new Error("timeoutMs must be positive");
    }
  }

  public async request<TResponse>(
    request: HookshotToDeviceRequest<TResponse>,
  ): Promise<TResponse> {
    const matrixClient = this.getMatrixClient();
    const sessionIdentity = getSessionIdentityForClient(matrixClient);

    const requestId = this.requestIdGenerator();
    if (!requestId) {
      throw new Error("The request ID generator returned an empty ID");
    }

    const content: Record<string, unknown> = {
      ...request.content,
      request_id: requestId,
      requesting_device_id: sessionIdentity.deviceId,
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    let resolveResponse!: (response: TResponse) => void;
    let rejectResponse!: (error: Error) => void;

    const responsePromise = new Promise<TResponse>((resolve, reject) => {
      resolveResponse = resolve;
      rejectResponse = reject;
    });

    const cleanup = (): void => {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      matrixClient.off(TO_DEVICE_EVENT_NAME, onToDeviceEvent);
    };

    const settle = (callback: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      callback();
    };

    const onToDeviceEvent = (event: MatrixToDeviceEvent): void => {
      if (event.getType() !== request.responseType) {
        return;
      }
      if (event.getSender() !== request.recipientUserId) {
        return;
      }

      const targetDeviceId = getTargetDeviceId(event);
      if (
        targetDeviceId !== undefined &&
        targetDeviceId !== sessionIdentity.deviceId
      ) {
        return;
      }

      let currentClient: ElementMatrixClient | null;
      try {
        currentClient = this.getMatrixClient();
      } catch {
        currentClient = null;
      }
      if (currentClient !== matrixClient) {
        settle(() => rejectResponse(new Error("Matrix account changed")));
        return;
      }

      let currentIdentity: MatrixSessionIdentity;
      try {
        currentIdentity = getSessionIdentityForClient(currentClient);
      } catch {
        settle(() => rejectResponse(new Error("Matrix account changed")));
        return;
      }
      if (
        currentIdentity.userId !== sessionIdentity.userId ||
        currentIdentity.deviceId !== sessionIdentity.deviceId
      ) {
        settle(() => rejectResponse(new Error("Matrix account changed")));
        return;
      }

      const responseContent = event.getContent();
      if (
        !isRecord(responseContent) ||
        responseContent.request_id !== requestId
      ) {
        return;
      }
      if (
        request.responseValidator &&
        !request.responseValidator(responseContent)
      ) {
        return;
      }

      settle(() => resolveResponse(responseContent as TResponse));
    };

    matrixClient.on(TO_DEVICE_EVENT_NAME, onToDeviceEvent);
    timer = setTimeout(() => {
      settle(() => rejectResponse(new Error("Timed out waiting for response")));
    }, request.timeoutMs ?? this.timeoutMs);

    try {
      const contentMap = new Map([
        [request.recipientUserId, new Map([["*", content]])],
      ]);
      await matrixClient.sendToDevice(
        request.requestType,
        contentMap,
        requestId,
      );
    } catch (error) {
      settle(() =>
        rejectResponse(
          error instanceof Error ? error : new Error("Failed to send request"),
        ),
      );
    }

    return responsePromise;
  }

  public getSessionIdentity(): MatrixSessionIdentity {
    return getSessionIdentityForClient(this.getMatrixClient());
  }

  private getMatrixClient(): ElementMatrixClient {
    const matrixClient = window.mxMatrixClientPeg?.safeGet();
    if (!matrixClient) {
      throw new Error("The Matrix client is unavailable");
    }
    return matrixClient;
  }
}
