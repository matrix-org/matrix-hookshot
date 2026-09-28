import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HookshotToDeviceClient,
  type ElementMatrixClient,
  type MatrixToDeviceEvent,
} from "../src/HookshotToDeviceClient";

const recipientUserId = "@hookshot:example.org";
const requestType = "org.matrix.matrix-hookshot.openproject.probe";
const responseType = "org.matrix.matrix-hookshot.openproject.probe.response";

class FakeMatrixClient {
  public readonly sendToDevice = vi.fn().mockResolvedValue(undefined);
  public userId = "@alice:example.org";
  public deviceId = "ELEMENTDEVICE";

  private readonly listeners = new Set<(event: MatrixToDeviceEvent) => void>();

  public getUserId(): string {
    return this.userId;
  }

  public getDeviceId(): string {
    return this.deviceId;
  }

  public on(
    _eventName: "toDeviceEvent",
    listener: (event: MatrixToDeviceEvent) => void,
  ): void {
    this.listeners.add(listener);
  }

  public off(
    _eventName: "toDeviceEvent",
    listener: (event: MatrixToDeviceEvent) => void,
  ): void {
    this.listeners.delete(listener);
  }

  public emit(event: MatrixToDeviceEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  public listenerCount(): number {
    return this.listeners.size;
  }
}

function event({
  content,
  deviceId = "ELEMENTDEVICE",
  sender = recipientUserId,
  type = responseType,
}: {
  content: unknown;
  deviceId?: string;
  sender?: string;
  type?: string;
}): MatrixToDeviceEvent {
  return {
    getContent: () => content,
    getSender: () => sender,
    getType: () => type,
    getUnsigned: () => ({ device_id: deviceId }),
  };
}

function installMatrixClient(matrixClient: ElementMatrixClient): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      mxMatrixClientPeg: {
        safeGet: () => matrixClient,
      },
    },
    writable: true,
  });
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
});

describe("HookshotToDeviceClient", () => {
  it("sends a request and resolves only its matching response", async () => {
    const matrixClient = new FakeMatrixClient();
    installMatrixClient(matrixClient as unknown as ElementMatrixClient);
    const client = new HookshotToDeviceClient({
      requestIdGenerator: () => "request-1",
    });

    const responsePromise = client.request<{
      request_id: string;
      result: string;
    }>({
      content: { request_id: "caller-cannot-override", value: "probe" },
      recipientUserId,
      requestType,
      responseType,
    });

    expect(matrixClient.sendToDevice).toHaveBeenCalledOnce();
    const [sentType, messageMap, transactionId] =
      matrixClient.sendToDevice.mock.calls[0];
    expect(sentType).toBe(requestType);
    expect(transactionId).toBe("request-1");
    expect(messageMap?.get(recipientUserId)?.get("*")).toEqual({
      request_id: "request-1",
      requesting_device_id: "ELEMENTDEVICE",
      value: "probe",
    });

    matrixClient.emit(
      event({ content: { request_id: "other-request", result: "ignore" } }),
    );
    matrixClient.emit(
      event({ content: { request_id: "request-1", result: "ok" } }),
    );

    await expect(responsePromise).resolves.toEqual({
      request_id: "request-1",
      result: "ok",
    });
    expect(matrixClient.listenerCount()).toBe(0);
  });

  it("ignores responses from another sender or device", async () => {
    const matrixClient = new FakeMatrixClient();
    installMatrixClient(matrixClient as unknown as ElementMatrixClient);
    const client = new HookshotToDeviceClient({
      requestIdGenerator: () => "request-2",
    });

    const responsePromise = client.request({
      content: {},
      recipientUserId,
      requestType,
      responseType,
    });

    matrixClient.emit(
      event({
        content: { request_id: "request-2" },
        sender: "@other:example.org",
      }),
    );
    matrixClient.emit(
      event({ content: { request_id: "request-2" }, deviceId: "OTHERDEVICE" }),
    );
    matrixClient.emit(
      event({ content: { request_id: "request-2", result: "ok" } }),
    );

    await expect(responsePromise).resolves.toEqual({
      request_id: "request-2",
      result: "ok",
    });
  });

  it("rejects on timeout and removes the listener", async () => {
    const matrixClient = new FakeMatrixClient();
    installMatrixClient(matrixClient as unknown as ElementMatrixClient);
    const client = new HookshotToDeviceClient({
      requestIdGenerator: () => "request-3",
    });

    const responsePromise = client.request({
      content: {},
      recipientUserId,
      requestType,
      responseType,
      timeoutMs: 1,
    });

    await expect(responsePromise).rejects.toThrow("Timed out waiting for");
    expect(matrixClient.listenerCount()).toBe(0);
  });

  it("rejects when the Element account changes while waiting", async () => {
    const firstMatrixClient = new FakeMatrixClient();
    const secondMatrixClient = new FakeMatrixClient();
    let activeMatrixClient: ElementMatrixClient =
      firstMatrixClient as unknown as ElementMatrixClient;

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        mxMatrixClientPeg: {
          safeGet: () => activeMatrixClient,
        },
      },
      writable: true,
    });

    const client = new HookshotToDeviceClient({
      requestIdGenerator: () => "request-4",
    });
    const responsePromise = client.request({
      content: {},
      recipientUserId,
      requestType,
      responseType,
    });

    activeMatrixClient = secondMatrixClient as unknown as ElementMatrixClient;
    firstMatrixClient.emit(event({ content: { request_id: "request-4" } }));

    await expect(responsePromise).rejects.toThrow("Matrix account changed");
    expect(firstMatrixClient.listenerCount()).toBe(0);
  });

  it("rejects when the user or device changes on the same Matrix client", async () => {
    const matrixClient = new FakeMatrixClient();
    installMatrixClient(matrixClient as unknown as ElementMatrixClient);
    const client = new HookshotToDeviceClient({
      requestIdGenerator: () => "request-identity-change",
    });
    const responsePromise = client.request({
      content: {},
      recipientUserId,
      requestType,
      responseType,
    });

    matrixClient.userId = "@bob:example.org";
    matrixClient.deviceId = "BOBDEVICE";
    matrixClient.emit(
      event({ content: { request_id: "request-identity-change" } }),
    );

    await expect(responsePromise).rejects.toThrow("Matrix account changed");
  });

  it("rejects when the Matrix session identity is unavailable", async () => {
    const matrixClient = new FakeMatrixClient();
    matrixClient.userId = "";
    installMatrixClient(matrixClient as unknown as ElementMatrixClient);
    const client = new HookshotToDeviceClient({
      requestIdGenerator: () => "request-no-identity",
    });

    await expect(
      client.request({
        content: {},
        recipientUserId,
        requestType,
        responseType,
      }),
    ).rejects.toThrow("no session identity");
  });

  it("does not access an Element access token", async () => {
    const matrixClient = new FakeMatrixClient() as FakeMatrixClient & {
      getAccessToken: ReturnType<typeof vi.fn>;
    };
    matrixClient.getAccessToken = vi.fn();
    installMatrixClient(matrixClient as unknown as ElementMatrixClient);
    matrixClient.sendToDevice.mockRejectedValueOnce(new Error("send failed"));
    const client = new HookshotToDeviceClient({
      requestIdGenerator: () => "request-5",
    });

    await expect(
      client.request({
        content: {},
        recipientUserId,
        requestType,
        responseType,
      }),
    ).rejects.toThrow("send failed");
    expect(matrixClient.getAccessToken).not.toHaveBeenCalled();
  });
});
