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
import {
  GenericHookConnection,
  GenericHookConnectionState,
} from "../src/Connections";

describe("Statically configured connection", () => {
  let testEnv: E2ETestEnv;

  beforeAll(async () => {
    const webhooksPort = 9500 + E2ETestEnv.workerId;
    testEnv = await E2ETestEnv.createTestEnv({
      matrixLocalparts: ["user"],
      staticConnectionRooms: {
        "my-room": { members: ["user"] },
      },
      config: {
        generic: {
          enabled: true,
          // Prefer to wait for complete as it reduces the concurrency of the test.
          waitForComplete: true,
          urlPrefix: `http://localhost:${webhooksPort}`,
          payloadSizeLimit: "10mb",
        },
        connections: [
          {
            roomId: "my-room",
            stateKey: "foo",
            connectionType: GenericHookConnection.CanonicalEventType,
            state: {
              name: "My hook",
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

  afterEach(() => {
    vitest.useRealTimers();
  });

  test("should be able to handle an incoming request.", async () => {
    const user = testEnv.getUser("user");
    const roomId = testEnv.connectionRooms["my-room"];
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
    console.log("waiting for msg");
    expect((await expectedMsg).data.content).toEqual({
      msgtype: "m.notice",
      body: "Received webhook data: Hello world",
      formatted_body: "<p>Received webhook data: Hello world</p>",
      format: "org.matrix.custom.html",
      "uk.half-shot.hookshot.webhook_data": "Hello world",
    });
    console.log("got msg");
  });
});
