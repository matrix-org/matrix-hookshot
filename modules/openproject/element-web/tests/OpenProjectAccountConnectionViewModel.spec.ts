import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  OpenProjectAnchor,
  OpenProjectLoginStartResponse,
  OpenProjectLoginStatusResponse,
} from "../src/capabilities/OpenProjectCapabilityClient";
import type { ProfileIdentity } from "../src/capabilities/OpenProjectProfile";
import {
  OPENPROJECT_LOGIN_POLL_DURATION_MS,
  OPENPROJECT_LOGIN_POLL_INTERVAL_MS,
  OpenProjectAccountConnectionViewModel,
  type OpenProjectLoginClient,
} from "../src/viewmodels/accountConnection/OpenProjectAccountConnectionViewModel";

const anchor: OpenProjectAnchor = {
  roomId: "!room:example.org",
  eventId: "$anchor:example.org",
  snapshotId: "snapshot-1",
  workPackageId: 41,
  recipientUserId: "@hookshot:example.org",
};
const baseUrl = new URL("https://projects.example.org/project/");
const authorizationUrl =
  "https://projects.example.org/oauth/authorize?client_id=example&state=sample-state";
const identity: ProfileIdentity = {
  userId: "@alice:example.org",
  deviceId: "ALICE_DEVICE",
};

function startResponse(
  result: OpenProjectLoginStartResponse["result"] = "ready",
): OpenProjectLoginStartResponse {
  return result === "ready"
    ? {
        v: 1,
        request_id: "start-request",
        integration_id: "openproject",
        result,
        auth_url: authorizationUrl,
      }
    : {
        v: 1,
        request_id: "start-request",
        integration_id: "openproject",
        result,
      };
}

function statusResponse(
  result: OpenProjectLoginStatusResponse["result"],
): OpenProjectLoginStatusResponse {
  return {
    v: 1,
    request_id: "status-request",
    integration_id: "openproject",
    result,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createClient() {
  let current = true;
  let sessionListener: (() => void) | undefined;
  const unsubscribe = vi.fn(() => {
    sessionListener = undefined;
  });
  const client = {
    loginStart: vi.fn<OpenProjectLoginClient["loginStart"]>(),
    loginStatus: vi.fn<OpenProjectLoginClient["loginStatus"]>(),
    getSessionIdentity: vi.fn(() => identity),
    isSessionIdentityCurrent: vi.fn(() => current),
    watchSessionIdentity: vi.fn(
      (_identity: ProfileIdentity, listener: () => void) => {
        sessionListener = listener;
        return unsubscribe;
      },
    ),
  } satisfies OpenProjectLoginClient;
  return {
    client,
    unsubscribe,
    changeSession: () => {
      current = false;
      sessionListener?.();
    },
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("OpenProjectAccountConnectionViewModel", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("starts once, validates the returned URL, and keeps it in dialog state", async () => {
    const { client } = createClient();
    const onComplete = vi.fn();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    client.loginStart.mockResolvedValue(startResponse());
    const model = new OpenProjectAccountConnectionViewModel(
      client,
      anchor,
      baseUrl,
      onComplete,
    );

    model.start();
    model.start();
    expect(client.loginStart).toHaveBeenCalledOnce();
    expect(client.loginStart).toHaveBeenCalledWith(anchor);
    await flushPromises();

    expect(model.getSnapshot()).toEqual({
      kind: "ready",
      authorizationUrl: new URL(authorizationUrl).href,
    });
    expect(onComplete).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    model.dispose();
  });

  it("does not request a URL when the configured base is missing", () => {
    const { client } = createClient();
    const model = new OpenProjectAccountConnectionViewModel(
      client,
      anchor,
      undefined,
      vi.fn(),
    );

    model.start();

    expect(model.getSnapshot()).toEqual({ kind: "configuration_error" });
    expect(client.loginStart).not.toHaveBeenCalled();
    model.dispose();
  });

  it.each([
    ["not_authorized", "denied"],
    ["unavailable", "unavailable"],
  ] as const)(
    "shows %s as %s without retaining a URL",
    async (result, kind) => {
      const { client } = createClient();
      client.loginStart.mockResolvedValue(startResponse(result));
      const model = new OpenProjectAccountConnectionViewModel(
        client,
        anchor,
        baseUrl,
        vi.fn(),
      );

      model.start();
      await flushPromises();

      expect(model.getSnapshot()).toEqual({ kind });
      model.dispose();
    },
  );

  it("completes once when login-start reports already connected", async () => {
    const { client, unsubscribe } = createClient();
    const onComplete = vi.fn();
    client.loginStart.mockResolvedValue(startResponse("already_connected"));
    const model = new OpenProjectAccountConnectionViewModel(
      client,
      anchor,
      baseUrl,
      onComplete,
    );

    model.start();
    await flushPromises();

    expect(model.getSnapshot()).toEqual({ kind: "connected" });
    expect(onComplete).toHaveBeenCalledOnce();
    expect(onComplete).toHaveBeenCalledWith(identity);
    expect(unsubscribe).toHaveBeenCalledOnce();
    model.dispose();
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("rejects a ready response whose URL does not match the trusted endpoint", async () => {
    const { client } = createClient();
    client.loginStart.mockResolvedValue({
      ...startResponse(),
      auth_url: "https://attacker.example.org/oauth/authorize?state=secret",
    });
    const model = new OpenProjectAccountConnectionViewModel(
      client,
      anchor,
      baseUrl,
      vi.fn(),
    );

    model.start();
    await flushPromises();

    expect(model.getSnapshot()).toEqual({ kind: "configuration_error" });
    expect(JSON.stringify(model.getSnapshot())).not.toContain("state=secret");
    model.dispose();
  });

  it("polls serially after each settled not-connected result and completes", async () => {
    vi.useFakeTimers();
    const { client } = createClient();
    const onComplete = vi.fn();
    client.loginStart.mockResolvedValue(startResponse());
    client.loginStatus
      .mockResolvedValueOnce(statusResponse("not_connected"))
      .mockResolvedValueOnce(statusResponse("connected"));
    const model = new OpenProjectAccountConnectionViewModel(
      client,
      anchor,
      baseUrl,
      onComplete,
    );
    model.start();
    await flushPromises();
    model.beginAuthorizationCheck();
    model.beginAuthorizationCheck();
    await flushPromises();

    expect(client.loginStatus).toHaveBeenCalledOnce();
    expect(model.getSnapshot().kind).toBe("polling");
    await vi.advanceTimersByTimeAsync(OPENPROJECT_LOGIN_POLL_INTERVAL_MS - 1);
    expect(client.loginStatus).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await flushPromises();

    expect(client.loginStatus).toHaveBeenCalledTimes(2);
    expect(model.getSnapshot()).toEqual({ kind: "connected" });
    expect(onComplete).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    model.dispose();
    vi.useRealTimers();
  });

  it("expires after two minutes and ignores a late status response", async () => {
    vi.useFakeTimers();
    const { client } = createClient();
    const pendingStatus = deferred<OpenProjectLoginStatusResponse>();
    client.loginStart.mockResolvedValue(startResponse());
    client.loginStatus.mockReturnValue(pendingStatus.promise);
    const model = new OpenProjectAccountConnectionViewModel(
      client,
      anchor,
      baseUrl,
      vi.fn(),
    );
    model.start();
    await flushPromises();
    model.beginAuthorizationCheck();
    await vi.advanceTimersByTimeAsync(OPENPROJECT_LOGIN_POLL_DURATION_MS);

    expect(model.getSnapshot()).toEqual({ kind: "expired" });
    pendingStatus.resolve(statusResponse("connected"));
    await flushPromises();
    expect(model.getSnapshot()).toEqual({ kind: "expired" });
    expect(client.loginStatus).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    model.dispose();
    vi.useRealTimers();
  });

  it("offers explicit retries after recoverable errors using a new start call", async () => {
    const { client } = createClient();
    client.loginStart
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce(startResponse());
    const model = new OpenProjectAccountConnectionViewModel(
      client,
      anchor,
      baseUrl,
      vi.fn(),
    );

    model.start();
    await flushPromises();
    expect(model.getSnapshot()).toEqual({ kind: "unavailable" });
    model.retry();
    await flushPromises();

    expect(client.loginStart).toHaveBeenCalledTimes(2);
    expect(model.getSnapshot().kind).toBe("ready");
    model.dispose();
  });

  it("clears a failed polling URL and retries with a fresh login-start request", async () => {
    const { client } = createClient();
    client.loginStart
      .mockResolvedValueOnce(startResponse())
      .mockResolvedValueOnce(startResponse());
    client.loginStatus.mockResolvedValue(statusResponse("unavailable"));
    const model = new OpenProjectAccountConnectionViewModel(
      client,
      anchor,
      baseUrl,
      vi.fn(),
    );
    model.start();
    await flushPromises();
    model.beginAuthorizationCheck();
    await flushPromises();

    expect(model.getSnapshot()).toEqual({ kind: "unavailable" });
    model.retry();
    await flushPromises();
    expect(client.loginStart).toHaveBeenCalledTimes(2);
    expect(model.getSnapshot().kind).toBe("ready");
    model.dispose();
  });

  it("clears the URL and polling when the account or device changes", async () => {
    const { client, changeSession, unsubscribe } = createClient();
    client.loginStart.mockResolvedValue(startResponse());
    const model = new OpenProjectAccountConnectionViewModel(
      client,
      anchor,
      baseUrl,
      vi.fn(),
    );

    model.start();
    await flushPromises();
    model.beginAuthorizationCheck();
    changeSession();

    expect(model.getSnapshot()).toEqual({ kind: "session_changed" });
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(client.loginStatus).toHaveBeenCalledOnce();
    model.dispose();
  });

  it("disposal clears polling and ignores a late successful response", async () => {
    vi.useFakeTimers();
    const { client } = createClient();
    const pendingStatus = deferred<OpenProjectLoginStatusResponse>();
    const onComplete = vi.fn();
    client.loginStart.mockResolvedValue(startResponse());
    client.loginStatus.mockReturnValue(pendingStatus.promise);
    const model = new OpenProjectAccountConnectionViewModel(
      client,
      anchor,
      baseUrl,
      onComplete,
    );
    model.start();
    await flushPromises();
    model.beginAuthorizationCheck();
    model.dispose();
    pendingStatus.resolve(statusResponse("connected"));
    await flushPromises();

    expect(model.getSnapshot()).toEqual({ kind: "cancelled" });
    expect(onComplete).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it("cancellation clears the authorization link and ignores late success", async () => {
    const { client, unsubscribe } = createClient();
    const pendingStatus = deferred<OpenProjectLoginStatusResponse>();
    const onComplete = vi.fn();
    client.loginStart.mockResolvedValue(startResponse());
    client.loginStatus.mockReturnValue(pendingStatus.promise);
    const model = new OpenProjectAccountConnectionViewModel(
      client,
      anchor,
      baseUrl,
      onComplete,
    );
    model.start();
    await flushPromises();
    model.beginAuthorizationCheck();
    model.cancel();
    pendingStatus.resolve(statusResponse("connected"));
    await flushPromises();

    expect(model.getSnapshot()).toEqual({ kind: "cancelled" });
    expect(onComplete).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
