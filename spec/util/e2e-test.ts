import { TestHomeServer, createHS, destroyHS } from "./homerunner";
import {
  Appservice,
  IAppserviceRegistration,
  MatrixClient,
  Membership,
  MembershipEventContent,
  PowerLevelsEventContent,
} from "matrix-bot-sdk";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { BridgeConfig, BridgeConfigRoot } from "../../src/config/Config";
import { start } from "../../src/App/BridgeApp";
import { RSAKeyPairOptions, generateKeyPair } from "node:crypto";
import path from "node:path";
import Redis from "ioredis";
import {
  BridgeConfigActorPermission,
  BridgeConfigServicePermission,
} from "../../src/libRs";
import { TestContainers } from "testcontainers";

const WAIT_EVENT_TIMEOUT = 20000;
export const E2ESetupTestTimeout = 60000;
const REDIS_DATABASE_URI =
  process.env.HOOKSHOT_E2E_REDIS_DB_URI ?? "redis://localhost:6379";

interface Opts<ML extends string> {
  matrixLocalparts?: ML[];
  permissionsRoom?: {
    members: string[];
    permissions: Array<BridgeConfigServicePermission>;
  };
  config?: Partial<BridgeConfigRoot>;
  enableE2EE?: boolean;
  useRedis?: boolean;
  e2eClientOpts?: E2ETestMatrixClientOpts;
}

interface WaitForEventResponse<T extends object = Record<string, unknown>> {
  roomId: string;
  data: {
    sender: string;
    type: string;
    state_key?: string;
    content: T;
    event_id: string;
  };
}

export interface E2ETestMatrixClientOpts {
  autoAcceptInvite: boolean;
}

export class E2ETestMatrixClient extends MatrixClient {
  constructor(
    private e2eOpts: E2ETestMatrixClientOpts,
    ...args: ConstructorParameters<typeof MatrixClient>
  ) {
    super(...args);
    if (e2eOpts.autoAcceptInvite) {
      this.on("room.invite", (eventRoomId: string) => {
        this.joinRoom(eventRoomId);
      });
    }
  }

  public async waitForPowerLevel(
    roomId: string,
    expected: Partial<PowerLevelsEventContent>,
  ): Promise<{
    roomId: string;
    data: {
      sender: string;
      type: string;
      state_key?: string;
      content: PowerLevelsEventContent;
      event_id: string;
    };
  }> {
    return this.waitForEvent(
      "room.event",
      (
        eventRoomId: string,
        eventData: {
          sender: string;
          type: string;
          content: Record<string, unknown>;
          event_id: string;
          state_key: string;
        },
      ) => {
        if (eventRoomId !== roomId) {
          return undefined;
        }

        if (eventData.type !== "m.room.power_levels") {
          return undefined;
        }

        if (eventData.state_key !== "") {
          return undefined;
        }

        // Check only the keys we care about
        for (const [key, value] of Object.entries(expected)) {
          const evValue = eventData.content[key] ?? undefined;
          const sortOrder =
            value !== null && typeof value === "object"
              ? Object.keys(value).sort()
              : undefined;
          const jsonLeft = JSON.stringify(evValue, sortOrder);
          const jsonRight = JSON.stringify(value, sortOrder);
          if (jsonLeft !== jsonRight) {
            return undefined;
          }
        }

        console.info(
          // eslint-disable-next-line max-len
          `${eventRoomId} ${eventData.event_id} ${eventData.sender}`,
        );
        return { roomId: eventRoomId, data: eventData };
      },
      `Timed out waiting for powerlevel from in ${roomId}`,
    );
  }

  private async innerWaitForRoomEvent<
    T extends object = Record<string, unknown>,
  >(
    {
      eventType,
      sender,
      roomId,
      stateKey,
      eventId,
      body,
    }: {
      eventType: string;
      sender: string;
      roomId?: string;
      stateKey?: string;
      body?: string;
      eventId?: string;
    },
    expectEncrypted: boolean,
  ): Promise<WaitForEventResponse<T>> {
    return this.waitForEvent(
      expectEncrypted ? "room.decrypted_event" : "room.event",
      (
        eventRoomId: string,
        eventData: {
          sender: string;
          type: string;
          state_key?: string;
          content: T;
          event_id: string;
        },
      ) => {
        if (eventData.sender !== sender) {
          return undefined;
        }
        if (eventData.type !== eventType) {
          return undefined;
        }
        if (roomId && eventRoomId !== roomId) {
          return undefined;
        }
        if (eventId && eventData.event_id !== eventId) {
          return undefined;
        }
        if (stateKey !== undefined && eventData.state_key !== stateKey) {
          return undefined;
        }
        const evtBody = "body" in eventData.content && eventData.content.body;
        if (body && body !== evtBody) {
          return undefined;
        }
        console.info(
          // eslint-disable-next-line max-len
          `${eventRoomId} ${eventData.event_id} ${eventData.type} ${eventData.sender} ${eventData.state_key ?? evtBody ?? ""}`,
        );
        return { roomId: eventRoomId, data: eventData };
      },
      `Timed out waiting for ${eventType} from ${sender} in ${roomId || "any room"}`,
    );
  }

  public async waitForRoomEvent<T extends object = Record<string, unknown>>(
    opts: Parameters<E2ETestMatrixClient["innerWaitForRoomEvent"]>[0],
  ): Promise<WaitForEventResponse<T>> {
    return this.innerWaitForRoomEvent(opts, false);
  }

  public async waitForEncryptedEvent<
    T extends object = Record<string, unknown>,
  >(
    opts: Parameters<E2ETestMatrixClient["innerWaitForRoomEvent"]>[0],
  ): Promise<WaitForEventResponse<T>> {
    return this.innerWaitForRoomEvent(opts, true);
  }

  public async waitForRoomMembership({
    sender,
    roomId,
    membership,
  }: {
    membership: Membership;
    sender: string;
    roomId?: string;
  }): Promise<{
    roomId: string;
    data: {
      sender: string;
      state_key: string;
      content: MembershipEventContent;
    };
  }> {
    return this.waitForEvent(
      "room.event",
      (
        eventRoomId: string,
        eventData: {
          sender: string;
          state_key: string;
          content: MembershipEventContent;
        },
      ) => {
        if (eventData.state_key !== sender) {
          return;
        }
        if (roomId && eventRoomId !== roomId) {
          return;
        }
        if (eventData.content.membership !== membership) {
          return;
        }
        return { roomId: eventRoomId, data: eventData };
      },
      `Timed out waiting for ${membership} to ${roomId || "any room"} from ${sender}`,
    );
  }

  public async waitForRoomJoin(opts: {
    sender: string;
    roomId?: string;
  }): ReturnType<E2ETestMatrixClient["waitForRoomMembership"]> {
    return this.waitForRoomMembership({ ...opts, membership: "join" });
  }

  public async waitForRoomLeave(opts: {
    sender: string;
    roomId?: string;
  }): ReturnType<E2ETestMatrixClient["waitForRoomMembership"]> {
    return this.waitForRoomMembership({ ...opts, membership: "leave" });
  }

  public async waitForRoomInvite(opts: {
    sender: string;
    roomId?: string;
  }): Promise<{ roomId: string; data: unknown }> {
    const { sender, roomId } = opts;
    return this.waitForEvent(
      "room.invite",
      (
        eventRoomId: string,
        eventData: {
          sender: string;
        },
      ) => {
        if (eventData.sender !== sender) {
          return undefined;
        }
        if (roomId && eventRoomId !== roomId) {
          return undefined;
        }
        return { roomId: eventRoomId, data: eventData };
      },
      `Timed out waiting for invite to ${roomId || "any room"} from ${sender}`,
    );
  }

  public async waitForEvent<T>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    emitterType: string,
    filterFn: (...args: any[]) => T | undefined,
    timeoutMsg: string,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      // eslint-disable-next-line prefer-const
      let timer: NodeJS.Timeout;
      const fn = (...args: unknown[]) => {
        const data = filterFn(...args);
        if (data) {
          clearTimeout(timer);
          resolve(data);
        }
      };
      timer = setTimeout(() => {
        this.removeListener(emitterType, fn);
        reject(new Error(timeoutMsg));
      }, WAIT_EVENT_TIMEOUT);
      this.on(emitterType, fn);
    });
  }
}

export class E2ETestEnv<ML extends string = string> {
  static get workerId() {
    return (process as any).__tinypool_state__.workerId;
  }

  static async createTestEnv<ML extends string>(
    opts: Opts<ML>,
  ): Promise<E2ETestEnv<ML>> {
    const workerID = this.workerId;
    const { matrixLocalparts, config: providedConfig } = opts;
    const keyPromise = new Promise<string>((resolve, reject) =>
      generateKeyPair(
        "rsa",
        {
          modulusLength: 4096,
          privateKeyEncoding: {
            type: "pkcs8",
            format: "pem",
          },
          publicKeyEncoding: {
            format: "pem",
            type: "pkcs1",
          },
        } satisfies RSAKeyPairOptions<"pem", "pem">,
        (err, _, privateKey) => {
          if (err) {
            reject(err);
          } else {
            resolve(privateKey);
          }
        },
      ),
    );

    const dir = await mkdtemp("hookshot-int-test");
    const clientOpts = opts.e2eClientOpts ?? {
      autoAcceptInvite: false,
    };
    // Configure homeserver and bots
    const [homeserver, privateKey] = await Promise.all([
      createHS(
        [...(matrixLocalparts || [])],
        clientOpts,
        workerID,
        opts.enableE2EE ? path.join(dir, "client-crypto") : undefined,
      ),
      keyPromise,
    ]);
    const keyPath = path.join(dir, "key.pem");
    await writeFile(keyPath, privateKey, "utf-8");
    const webhooksPort = 9500 + workerID;

    if (providedConfig?.widgets) {
      providedConfig.widgets.openIdOverrides = {
        hookshot: homeserver.url,
      };
    }

    if (providedConfig?.github) {
      providedConfig.github.auth.privateKeyFile = keyPath;
    }

    opts.useRedis = opts.enableE2EE || opts.useRedis;

    let cacheConfig: BridgeConfigRoot["cache"] | undefined;
    if (opts.useRedis) {
      cacheConfig = {
        redisUri: `${homeserver.containers.redis.getConnectionUrl()}/${workerID}`,
      };
    }

    const registration: IAppserviceRegistration = {
      as_token: homeserver.asToken,
      hs_token: homeserver.hsToken,
      sender_localpart: "hookshot",
      namespaces: {
        users: [
          {
            regex: `@hookshot:${homeserver.domain}`,
            exclusive: true,
          },
        ],
        rooms: [],
        aliases: [],
      },
      "de.sorunome.msc2409.push_ephemeral": true,
    };

    let permissions: BridgeConfigActorPermission[] = [];
    if (opts.permissionsRoom) {
      const botClient = new MatrixClient(homeserver.url, homeserver.asToken);
      const permsRoom = await botClient.createRoom({
        name: "Permissions room",
        invite: opts.permissionsRoom.members.map(
          (localpart) => `@${localpart}:${homeserver.domain}`,
        ),
      });
      permissions.push({
        actor: permsRoom,
        services: opts.permissionsRoom.permissions,
      });
    } else {
      permissions = [
        {
          actor: "*",
          services: [{ level: "manageConnections" }],
        },
      ];
    }
    const config = new BridgeConfig({
      bridge: {
        domain: homeserver.domain,
        url: homeserver.url,
        port: homeserver.appPort,
        bindAddress: "0.0.0.0",
      },
      logging: {
        level: "debug",
      },
      // Always enable webhooks so that hookshot starts.
      generic: {
        enabled: true,
        urlPrefix: `http://localhost:${webhooksPort}/webhook`,
      },
      listeners: [
        {
          port: webhooksPort,
          bindAddress: "0.0.0.0",
          resources: ["webhooks"],
        },
      ],
      passFile: keyPath,
      ...(opts.enableE2EE
        ? {
            encryption: {
              storagePath: path.join(dir, "crypto-store"),
            },
          }
        : undefined),
      cache: cacheConfig,
      permissions,
      ...providedConfig,
    });
    const app = await start(config, registration);
    app.listener.finaliseListeners();

    return new E2ETestEnv(homeserver, app, opts, config, dir);
  }

  private constructor(
    public readonly homeserver: TestHomeServer,
    public app: Awaited<ReturnType<typeof start>>,
    public readonly opts: Opts<ML>,
    private readonly config: BridgeConfig,
    private readonly dir: string,
  ) {
    const appService = app.appservice;
    // Setup the appservice ping endpoint
    appService.expressAppInstance.post("/_matrix/app/v1/ping", (_req, res) =>
      res.status(200).send({}),
    );

    // Patch the "begin" function to expose host ports, and ping the appservice
    // The reason we don't do this unconditionally, is that if we never start the appservice,
    // the HS will try to contact it, which will throw an exception on the local process if port was exposed,
    // which mocha will catch and report as a test failure.
    const originalBegin = appService.begin.bind(appService);
    appService.begin = async () => {
      await originalBegin();

      // It looks like having the port forwarder setup before
      // we actually start the appservice sometimes causes issues
      await TestContainers.exposeHostPorts(config.bridge.port);

      // Ask the HS to ping the appservice.
      // TODO: Because of crypto reasons, the appservice bot client might not be a "true" appservice session
      // but instead a crypto session. For this reason we need to do a raw request.
      new MatrixClient(homeserver.url, homeserver.asToken).doRequest(
        "POST",
        `/_matrix/client/v1/appservice/hookshot/ping`,
        null,
        {},
      );
    };
  }

  public get botMxid() {
    return `@hookshot:${this.homeserver.domain}`;
  }

  public async setUp(): Promise<void> {
    await this.app.bridgeApp.start();
  }

  public async tearDown(): Promise<void> {
    await destroyHS(this.homeserver);
    await this.app.bridgeApp.stop();
    await this.app.listener.stop();
    await this.app.storage.disconnect?.();
    this.homeserver.users.forEach((u) => u.client.stop());
    await rm(this.dir, { recursive: true });
  }

  public getUser(localpart: ML) {
    const u = this.homeserver.users.find(
      (u) => u.userId === `@${localpart}:${this.homeserver.domain}`,
    );
    if (!u) {
      throw Error("User missing from test");
    }
    return u.client;
  }
}
