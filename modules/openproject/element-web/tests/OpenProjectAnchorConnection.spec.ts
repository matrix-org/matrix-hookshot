import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenProjectConnectionNotifier } from "../src/OpenProjectConnectionNotifier";
import type {
  OpenProjectAnchor,
  OpenProjectCapabilityClient,
  OpenProjectProbeResponse,
} from "../src/capabilities/OpenProjectCapabilityClient";
import type { ProfileIdentity } from "../src/capabilities/OpenProjectProfile";
import { AnchorMessageViewModel } from "../src/viewmodels/workPackage/AnchorMessageViewModel";
import { activeAnchorContent } from "./fixtures/OpenProjectContractFixtures";

const identity: ProfileIdentity = {
  userId: "@alice:example.org",
  deviceId: "ALICEDEVICE",
};

const anchor: OpenProjectAnchor = {
  roomId: "!room:example.org",
  eventId: "$anchor:example.org",
  snapshotId: "snapshot-1",
  workPackageId: 50,
  recipientUserId: "@hookshot_openproject:example.org",
};

function response(
  result: OpenProjectProbeResponse["result"],
  login?: NonNullable<OpenProjectProbeResponse["login"]>,
): OpenProjectProbeResponse {
  return {
    v: 1,
    request_id: "probe-request",
    integration_id: "openproject",
    result,
    ...(result === "ok" ? { connection: "connected" as const } : {}),
    ...(login === undefined ? {} : { login }),
  };
}

function makeClient(
  probe: OpenProjectCapabilityClient["probe"],
  isSessionIdentityCurrent: OpenProjectCapabilityClient["isSessionIdentityCurrent"] = () =>
    true,
) {
  let onSessionChange: (() => void) | undefined;
  const client = {
    probe,
    getSessionIdentity: () => identity,
    isSessionIdentityCurrent,
    watchSessionIdentity: (
      _identity: ProfileIdentity,
      listener: () => void,
    ) => {
      onSessionChange = listener;
      return vi.fn();
    },
  } as unknown as OpenProjectCapabilityClient;
  return { client, triggerSessionChange: () => onSessionChange?.() };
}

afterEach(() => vi.restoreAllMocks());

describe("OpenProject anchor connection", () => {
  it("offers account linking only for the current active anchor with advertised capability and trusted config", async () => {
    const onConnectAccount = vi.fn();
    const probe = vi
      .fn()
      .mockResolvedValue(response("not_connected", "available"));
    const { client } = makeClient(probe);
    const vm = new AnchorMessageViewModel({
      anchor,
      capabilityClient: client,
      data: activeAnchorContent,
      isTrustedAnchor: true,
      baseUrl: new URL("https://projects.example.org"),
      onConnectAccount,
    });

    await vi.waitFor(() => expect(vm.getSnapshot()?.canConnect).toBe(true));
    vm.connectAccount();
    expect(onConnectAccount).toHaveBeenCalledWith(anchor);

    const withoutConfig = new AnchorMessageViewModel({
      anchor,
      capabilityClient: client,
      data: activeAnchorContent,
      isTrustedAnchor: true,
      onConnectAccount,
    });
    await vi.waitFor(() =>
      expect(withoutConfig.getSnapshot()?.probe.kind).toBe("result"),
    );
    withoutConfig.connectAccount();
    expect(onConnectAccount).toHaveBeenCalledOnce();
    vm.dispose();
    withoutConfig.dispose();
  });

  it("invalidates pending results and re-probes each card's own anchor after matching completion", async () => {
    let resolveFirst!: (value: OpenProjectProbeResponse) => void;
    let resolveSecond!: (value: OpenProjectProbeResponse) => void;
    const first = new Promise<OpenProjectProbeResponse>((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise<OpenProjectProbeResponse>((resolve) => {
      resolveSecond = resolve;
    });
    const probe = vi
      .fn<OpenProjectCapabilityClient["probe"]>()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const { client } = makeClient(probe);
    const notifier = new OpenProjectConnectionNotifier();
    const vm = new AnchorMessageViewModel({
      anchor,
      capabilityClient: client,
      data: activeAnchorContent,
      isTrustedAnchor: true,
      baseUrl: new URL("https://projects.example.org"),
      connectionNotifier: notifier,
    });

    expect(vm.getSnapshot()?.probe.kind).toBe("loading");
    notifier.notify(identity);
    notifier.notify(identity);
    await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(2));
    expect(probe.mock.calls[1]?.[0]).toEqual(anchor);
    expect(vm.getSnapshot()?.probe.kind).toBe("loading");

    resolveFirst(response("not_connected", "available"));
    await Promise.resolve();
    expect(vm.getSnapshot()?.probe.kind).toBe("loading");
    resolveSecond(response("ok"));
    await vi.waitFor(() =>
      expect(vm.getSnapshot()?.probe).toMatchObject({
        kind: "result",
        result: "ok",
      }),
    );
    expect(vm.getSnapshot()?.canConnect).toBe(false);
    vm.dispose();
    notifier.dispose();
  });

  it("clears stale capability state and probes again after a session change", async () => {
    const probe = vi
      .fn<OpenProjectCapabilityClient["probe"]>()
      .mockResolvedValueOnce(response("ok"))
      .mockResolvedValue(response("not_connected", "available"));
    const { client, triggerSessionChange } = makeClient(probe);
    const vm = new AnchorMessageViewModel({
      anchor,
      capabilityClient: client,
      data: activeAnchorContent,
      isTrustedAnchor: true,
      baseUrl: new URL("https://projects.example.org"),
    });

    await vi.waitFor(() =>
      expect(vm.getSnapshot()?.probe).toMatchObject({
        kind: "result",
        result: "ok",
      }),
    );
    triggerSessionChange();
    expect(vm.getSnapshot()?.probe.kind).toBe("loading");
    await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(vm.getSnapshot()?.canConnect).toBe(true));
    vm.dispose();
  });
});
