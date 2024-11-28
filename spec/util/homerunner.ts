import { MatrixClient, MemoryStorageProvider, RustSdkCryptoStorageProvider, RustSdkCryptoStoreType } from "matrix-bot-sdk";
import { createHash, createHmac, randomUUID } from "crypto";
import { Homerunner } from "homerunner-client";
import { E2ETestMatrixClient } from "./e2e-test";
import path from "node:path";

const HOMERUNNER_IMAGE = process.env.HOMERUNNER_IMAGE || 'ghcr.io/element-hq/synapse/complement-synapse:nightly';
export const DEFAULT_REGISTRATION_SHARED_SECRET = (
    process.env.REGISTRATION_SHARED_SECRET || 'complement'
);
const COMPLEMENT_HOSTNAME_RUNNING_COMPLEMENT = (
    process.env.COMPLEMENT_HOSTNAME_RUNNING_COMPLEMENT || "host.docker.internal"
);

const homerunner = new Homerunner.Client();

export interface ComplementHomeServer {
    id: string,
    url: string,
    domain: string,
    users: {userId: string, accessToken: string, deviceId: string, client: E2ETestMatrixClient}[]
    asToken: string,
    hsToken: string,
    appPort: number,
}

async function waitForHomerunner() {
    let attempts = 0;
    do {
        attempts++;
        console.log(`Waiting for homerunner to be ready (${attempts}/100)`);
        try {
            await homerunner.health();
            break;
        }
        catch (ex) {
            await new Promise(r => setTimeout(r, 1000));
        }
    } while (attempts < 100)
    if (attempts === 100) {
        throw Error('Homerunner was not ready after 100 attempts');
    }
}

export async function createHS(localparts: string[] = [], workerId: number, cryptoRootPath?: string): Promise<ComplementHomeServer> {
    await waitForHomerunner();

    const appPort = 49600 + workerId;
    const blueprint = `hookshot_integration_test_${Date.now()}`;
    const asToken = randomUUID();
    const hsToken = randomUUID();
    const blueprintResponse = await homerunner.create({
        base_image_uri: HOMERUNNER_IMAGE,
        blueprint: {
            Name: blueprint,
            Homeservers: [{
                Name: 'hookshot',
                Users: localparts.map(localpart => ({Localpart: localpart, DisplayName: localpart})),
                ApplicationServices: [{
                    ID: 'hookshot',
                    URL: `http://${COMPLEMENT_HOSTNAME_RUNNING_COMPLEMENT}:${appPort}`,
                    SenderLocalpart: 'hookshot',
                    RateLimited: false,
                    ASToken: asToken,
                    HSToken: hsToken,
                    SendEphemeral: true,
                    EnableEncryption: true,
                }]
            }],
        }
    });
    const [homeserverName, homeserver] = Object.entries(blueprintResponse.homeservers)[0];
    // Skip AS user.
    const users = await Promise.all(Object.entries(homeserver.AccessTokens)
        .filter(([_uId, accessToken]) => accessToken !== asToken)
        .map(async ([userId, accessToken]) => {
            const cryptoStore = cryptoRootPath ? new RustSdkCryptoStorageProvider(path.join(cryptoRootPath, userId), RustSdkCryptoStoreType.Sqlite) : undefined;
            const client = new E2ETestMatrixClient(homeserver.BaseURL, accessToken, new MemoryStorageProvider(), cryptoStore);
            if (cryptoStore) {
                await client.crypto.prepare();
            }
            // Start syncing proactively.
            await client.start();
            return {
                userId: userId,
                accessToken,
                deviceId: homeserver.DeviceIDs[userId],
                client,
            }
        }
    ));


    return {
        users,
        id: blueprint,
        url: homeserver.BaseURL,
        domain: homeserverName,
        asToken,
        appPort,
        hsToken,
    };
}

export function destroyHS(
    id: string
): Promise<void> {
    return homerunner.destroy(id);
}

export async function registerUser(
    homeserverUrl: string,
    user: { username: string, admin: boolean },
    sharedSecret = DEFAULT_REGISTRATION_SHARED_SECRET,
): Promise<{mxid: string, client: MatrixClient}> {
    const registerUrl: string = (() => {
        const url = new URL(homeserverUrl);
        url.pathname = '/_synapse/admin/v1/register';
        return url.toString();
    })();

    const nonce = await fetch(registerUrl, { method: 'GET' }).then(res => res.json()).then((res) => (res as any).nonce);
    const password = createHash('sha256')
        .update(user.username)
        .update(sharedSecret)
        .digest('hex');
    const hmac = createHmac('sha1', sharedSecret)
        .update(nonce).update("\x00")
        .update(user.username).update("\x00")
        .update(password).update("\x00")
        .update(user.admin ? 'admin' : 'notadmin')
        .digest('hex');
    const req = await fetch(registerUrl, { method: "POST", body: JSON.stringify(
        {
            nonce,
            username: user.username,
            password,
            admin: user.admin,
            mac: hmac,
        }
    )});
    const res = await req.json() as {user_id: string, access_token: string};
    return {
        mxid: res.user_id,
        client: new MatrixClient(homeserverUrl, res.access_token),
    };
}
