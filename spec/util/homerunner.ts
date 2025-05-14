import {
  MatrixClient,
  MemoryStorageProvider,
  RustSdkCryptoStorageProvider,
  RustSdkCryptoStoreType,
} from "matrix-bot-sdk";
import { createHash, createHmac } from "crypto";
import { E2ETestMatrixClient, E2ETestMatrixClientOpts } from "./e2e-test";
import path from "node:path";
import { createContainers, TestContainerNetwork } from "./containers";
import { TestContainers } from "testcontainers";

export interface TestHomeServer {
  url: string;
  domain: string;
  users: {
    userId: string;
    accessToken: string;
    deviceId: string;
    client: E2ETestMatrixClient;
  }[];
  asToken: string;
  hsToken: string;
  appPort: number;
  containers: TestContainerNetwork;
}

// Due to a bug with testcontainers, we can't reuse a port twice without *issues*.
// This is slightly hacky as it should ensure we never use the same port twice.
let incrementalPort = 1;

export async function createHS(
  localparts: string[] = [],
  clientOpts: E2ETestMatrixClientOpts,
  workerId: number,
  cryptoRootPath?: string,
): Promise<TestHomeServer> {
  // The worker ID is provided to ensure that across different worker processes we still have a unique port.
  const appPort = 49600 + workerId * 100 + incrementalPort++;
  const containers = await createContainers("hookshot", appPort);

  // Create users
  const rawUsers = await Promise.all(
    localparts.map((username) =>
      registerUser(
        containers.synapse.baseUrl,
        { username, admin: false },
        containers.synapse.registrationSecret,
      ),
    ),
  );

  // Skip AS user.
  const users = await Promise.all(
    rawUsers.map(async ({ mxid, client }) => {
      const cryptoStore = cryptoRootPath
        ? new RustSdkCryptoStorageProvider(path.join(cryptoRootPath, mxid), 0)
        : undefined;
      const e2eClient = new E2ETestMatrixClient(
        clientOpts,
        containers.synapse.baseUrl,
        client.accessToken,
        new MemoryStorageProvider(),
        cryptoStore,
      );
      if (cryptoStore) {
        await e2eClient.crypto.prepare();
      }
      // Start syncing proactively.
      await e2eClient.start();
      return {
        userId: mxid,
        accessToken: client.accessToken,
        deviceId: (await client.getWhoAmI()).device_id!,
        client: e2eClient,
      };
    }),
  );

  return {
    users,
    url: containers.synapse.baseUrl,
    domain: containers.synapse.serverName,
    asToken: containers.registration.as_token,
    appPort,
    hsToken: containers.registration.hs_token,
    containers,
  };
}

export async function destroyHS(hs: TestHomeServer): Promise<void> {
  await hs.containers.synapse.stop();
  await hs.containers.redis.stop();
  await hs.containers.network.stop();
}

export async function registerUser(
  homeserverUrl: string,
  user: { username: string; admin: boolean },
  sharedSecret: string,
): Promise<{ mxid: string; client: MatrixClient }> {
  const registerUrl: string = (() => {
    const url = new URL(homeserverUrl);
    url.pathname = "/_synapse/admin/v1/register";
    return url.toString();
  })();

  const nonce = await fetch(registerUrl, { method: "GET" })
    .then((res) => res.json())
    .then((res) => (res as any).nonce);
  const password = createHash("sha256")
    .update(user.username)
    .update(sharedSecret)
    .digest("hex");
  const hmac = createHmac("sha1", sharedSecret)
    .update(nonce)
    .update("\x00")
    .update(user.username)
    .update("\x00")
    .update(password)
    .update("\x00")
    .update(user.admin ? "admin" : "notadmin")
    .digest("hex");
  const req = await fetch(registerUrl, {
    method: "POST",
    body: JSON.stringify({
      nonce,
      username: user.username,
      password,
      admin: user.admin,
      mac: hmac,
    }),
  });
  const res = (await req.json()) as { user_id: string; access_token: string };
  return {
    mxid: res.user_id,
    client: new MatrixClient(homeserverUrl, res.access_token),
  };
}
