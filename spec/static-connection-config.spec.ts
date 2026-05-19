import { E2ESetupTestTimeout, E2ETestEnv } from "./util/e2e-test";
import {
  describe,
  test,
  beforeAll,
  afterAll,
  afterEach,
  expect,
  vitest,
} from "vitest";
import { BridgeConfigRoot } from "../src/config/Config";
import {
  GenericHookConnection,
  GenericHookConnectionState,
} from "../src/Connections";

async function createTestEnvironment(
  connections: BridgeConfigRoot["connections"],
): Promise<E2ETestEnv> {
  const testEnv = await E2ETestEnv.createTestEnv({
    matrixLocalparts: ["user"],
    staticConnectionRooms: {
      "room-basic": { members: ["user"] },
      "room-func": { members: ["user"] },
    },
    config: {
      generic: {
        enabled: true,
        // Prefer to wait for complete as it reduces the concurrency of the test.
        waitForComplete: true,
        urlPrefix: `http://localhost:${webhooksPort}`,
        payloadSizeLimit: "10mb",
        allowJsTransformationFunctions: true,
      },
      connections,
      listeners: [
        {
          port: webhooksPort,
          bindAddress: "0.0.0.0",
          // Bind to the SAME listener to ensure we don't have conflicts.
          resources: ["webhooks"],
        },
      ],
    },
  });
  await testEnv.setUp();
  return testEnv;
}

describe("Statically configured connection", () => {
  let testEnv: E2ETestEnv;

  beforeAll(async () => {
    const webhooksPort = 9500 + E2ETestEnv.workerId;
    testEnv = await E2ETestEnv.createTestEnv({
      matrixLocalparts: ["user"],
      staticConnectionRooms: {
        "room-basic": { members: ["user"] },
        "room-func": { members: ["user"] },
      },
      config: {
        generic: {
          enabled: true,
          // Prefer to wait for complete as it reduces the concurrency of the test.
          waitForComplete: true,
          urlPrefix: `http://localhost:${webhooksPort}`,
          payloadSizeLimit: "10mb",
          allowJsTransformationFunctions: true,
        },
        connections: [
          {
            roomId: "room-basic",
            stateKey: "foo",
            connectionType: GenericHookConnection.CanonicalEventType,
            state: {
              name: "My hook",
            } satisfies GenericHookConnectionState,
          },
          // This is not great, but our test files seem to complain unless we have one env per file..
          {
            roomId: "room-func",
            stateKey: "foo",
            connectionType: GenericHookConnection.CanonicalEventType,
            state: {
              name: "My hook",
              transformationFunction: `result = {
        plain: "Hello world",
        version: "v2",
      };`,
            } satisfies GenericHookConnectionState,
          },
        ],
        listeners: [
          {
            port: webhooksPort,
            bindAddress: "0.0.0.0",
            // Bind to the SAME listener to ensure we don't have conflicts.
            resources: ["webhooks"],
          },
        ],
      },
    });
    await testEnv.setUp();
  }, E2ESetupTestTimeout);

  afterAll(() => {
    return testEnv?.tearDown();
  });

  test("can configure a basic webhook.", async () => {
    const user = testEnv.getUser("user");
    const roomId = testEnv.connectionRooms["room-basic"];
    await user.joinRoom(roomId);
    const url = new URL(
      testEnv.opts.config?.generic?.urlPrefix! + "/webhook/foo",
    );

    const expectedMsg = user.waitForRoomEvent({
      eventType: "m.room.message",
      sender: testEnv.botMxid,
      roomId,
    });

    const req = await fetch(url, {
      method: "PUT",
      body: "Hello world",
    });
    expect(req.status).toEqual(200);
    expect(await req.json()).toEqual({ ok: true });
    expect((await expectedMsg).data.content).toEqual({
      msgtype: "m.notice",
      body: "Received webhook data: Hello world",
      formatted_body: "<p>Received webhook data: Hello world</p>",
      format: "org.matrix.custom.html",
      "uk.half-shot.hookshot.webhook_data": "Hello world",
    });
  });

  test("can configure a webhook with transformation functions", async () => {
    const user = testEnv.getUser("user");
    const roomId = testEnv.connectionRooms["room-func"];
    await user.joinRoom(roomId);
    const url = new URL(
      testEnv.opts.config?.generic?.urlPrefix! + "/webhook/foo",
    );

    const expectedMsg = user.waitForRoomEvent({
      eventType: "m.room.message",
      sender: testEnv.botMxid,
      roomId,
    });

    const req = await fetch(url, {
      method: "PUT",
      body: "{}",
    });
    expect(req.status).toEqual(200);
    expect(await req.json()).toEqual({ ok: true });
    expect((await expectedMsg).data.content).toEqual({
      msgtype: "m.notice",
      body: "Hello world",
      format: "org.matrix.custom.html",
      formatted_body: "<p>Hello world</p>",
      "uk.half-shot.hookshot.webhook_data": "{}",
    });
  });
});
