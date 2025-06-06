import {
  E2ESetupTestTimeout,
  E2ETestEnv,
  E2ETestMatrixClient,
} from "./util/e2e-test";
import {
  describe,
  test,
  beforeAll,
  afterAll,
  afterEach,
  beforeEach,
  expect,
} from "vitest";
import { OutboundHookConnection } from "../src/Connections";
import { TextualMessageEventContent } from "matrix-bot-sdk";
import { IncomingHttpHeaders, Server, createServer } from "http";
import busboy, { FileInfo } from "busboy";
import { TEST_FILE } from "./util/fixtures";
import { AddressInfo } from "net";

async function createHttpServer(): Promise<Server> {
  const server = createServer();
  await new Promise<void>((req) => server.listen(0, () => req()));
  return server;
}

async function createOutboundConnection(
  user: E2ETestMatrixClient,
  botMxid: string,
  roomId: string,
  server: Server,
) {
  const join = user.waitForRoomJoin({ sender: botMxid, roomId });
  const connectionEvent = user.waitForRoomEvent({
    eventType: OutboundHookConnection.CanonicalEventType,
    stateKey: "test",
    sender: botMxid,
  });
  await user.inviteUser(botMxid, roomId);
  await user.setUserPowerLevel(botMxid, roomId, 50);
  await join;

  // Note: Here we create the DM proactively so this works across multiple
  // tests.
  // Get the DM room so we can get the token.
  const dmRoomId = await user.dms.getOrCreateDm(botMxid);

  const port = (server.address() as AddressInfo).port;

  await user.sendText(
    roomId,
    `!hookshot outbound-hook test http://localhost:${port}/test-path`,
  );
  // Test the contents of this.
  await connectionEvent;

  const msgPromise = user.waitForRoomEvent({
    sender: botMxid,
    eventType: "m.room.message",
    roomId: dmRoomId,
  });
  const { data: msgData } = await msgPromise;

  const [_match, token] =
    /<code>(.+)<\/code>/.exec(
      (msgData.content as unknown as TextualMessageEventContent)
        .formatted_body ?? "",
    ) ?? [];
  return token;
}

function awaitOutboundWebhook(server: Server): Promise<{
  headers: IncomingHttpHeaders;
  files: { name: string; file: Buffer; info: FileInfo }[];
}> {
  return new Promise<{
    headers: IncomingHttpHeaders;
    files: { name: string; file: Buffer; info: FileInfo }[];
  }>((resolve, reject) => {
    server.on("request", (req, res) => {
      const bb = busboy({ headers: req.headers });
      const files: { name: string; file: Buffer; info: FileInfo }[] = [];
      bb.on("file", (name, stream, info) => {
        const buffers: Buffer[] = [];
        stream.on("data", (d) => {
          buffers.push(d);
        });
        stream.once("close", () => {
          files.push({ name, info, file: Buffer.concat(buffers) });
        });
      });

      bb.once("close", () => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("OK");
        resolve({
          headers: req.headers,
          files,
        });
        clearTimeout(timer);
      });

      req.pipe(bb);
    });
    let timer: NodeJS.Timeout;
    timer = setTimeout(() => {
      reject(new Error("Request did not arrive"));
    }, 10000);
  });
}

describe("OutboundHooks", () => {
  let testEnv: E2ETestEnv;
  let server: Server;

  beforeAll(async () => {
    const webhooksPort = 9500 + E2ETestEnv.workerId;
    testEnv = await E2ETestEnv.createTestEnv({
      matrixLocalparts: ["user"],
      config: {
        generic: {
          enabled: true,
          outbound: true,
          urlPrefix: `http://localhost:${webhooksPort}`,
        },
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

  afterEach(() => {
    try {
      server.close();
    } catch {
      // Ignore, we tried.
    }
  });

  afterAll(async () => {
    await testEnv?.tearDown();
  });

  test("should be able to create a new webhook and push an event.", async () => {
    const user = testEnv.getUser("user");
    const roomId = await user.createRoom({ name: "My Test Webhooks room" });
    server = await createHttpServer();
    const gotWebhookRequest = awaitOutboundWebhook(server);
    const token = await createOutboundConnection(
      user,
      testEnv.botMxid,
      roomId,
      server,
    );

    const eventId = await user.sendText(roomId, "hello!");
    const { headers, files } = await gotWebhookRequest;
    expect(headers["x-matrix-hookshot-roomid"]).toEqual(roomId);
    expect(headers["x-matrix-hookshot-eventid"]).toEqual(eventId);
    expect(headers["x-matrix-hookshot-token"]).toEqual(token);

    // And check the JSON payload
    const [event, media] = files;
    expect(event.name).toEqual("event");
    expect(event.info.mimeType).toEqual("application/json");
    expect(event.info.filename).toEqual("event_data.json");
    const eventJson = JSON.parse(event.file.toString("utf-8"));

    // Check that the content looks sane.
    expect(eventJson.room_id).toEqual(roomId);
    expect(eventJson.event_id).toEqual(eventId);
    expect(eventJson.sender).toEqual(await user.getUserId());
    expect(eventJson.content.body).toEqual("hello!");

    // No media should be present.
    expect(media).toBeUndefined();
  });

  test("should be able to create a new webhook and push a media attachment.", async () => {
    const user = testEnv.getUser("user");
    const roomId = await user.createRoom({ name: "My Test Webhooks room" });
    server = await createHttpServer();
    const gotWebhookRequest = awaitOutboundWebhook(server);
    const token = await createOutboundConnection(
      user,
      testEnv.botMxid,
      roomId,
      server,
    );

    const mxcUrl = await user.uploadContent(
      TEST_FILE,
      "image/svg+xml",
      "matrix.svg",
    );
    await user.sendMessage(roomId, {
      url: mxcUrl,
      msgtype: "m.file",
      body: "matrix.svg",
    });
    const { files } = await gotWebhookRequest;
    const [event, media] = files;
    expect(event.info.mimeType).toEqual("application/json");
    expect(event.info.filename).toEqual("event_data.json");
    const eventJson = JSON.parse(event.file.toString("utf-8"));
    expect(eventJson.content.body).toEqual("matrix.svg");

    expect(media.info.mimeType).toEqual("image/svg+xml");
    expect(media.info.filename).toEqual("matrix.svg");
    expect(media.file).toEqual(TEST_FILE);
  });

  // TODO: This requires us to support Redis in test conditions, as encryption is not possible
  // in hookshot without it at the moment.

  // it.only('should be able to create a new webhook and push an encrypted media attachment.', async () => {
  //     const user = testEnv.getUser('user');
  //     const roomId = await user.createRoom({ name: 'My Test Webhooks room', initial_state: [{
  //         content: {
  //             "algorithm": "m.megolm.v1.aes-sha2"
  //         },
  //         state_key: "",
  //         type: "m.room.encryption"
  //     }]});
  //     await createOutboundConnection(user, testEnv.botMxid, roomId);
  //     const gotWebhookRequest = awaitOutboundWebhook();

  //     const encrypted = await user.crypto.encryptMedia(Buffer.from(TEST_FILE));
  //     const mxc = await user.uploadContent(TEST_FILE);
  //     await  user.sendMessage(roomId, {
  //         msgtype: "m.image",
  //         body: "matrix.svg",
  //         info: {
  //             mimetype: "image/svg+xml",
  //         },
  //         file: {
  //             url: mxc,
  //             ...encrypted.file,
  //         },
  //     });

  //     const { headers, files } = await gotWebhookRequest;
  //     const [event, media] = files;
  //     expect(event.info.mimeType).toEqual('application/json');
  //     expect(event.info.filename).toEqual('event_data.json');
  //     const eventJson = JSON.parse(event.file.toString('utf-8'));
  //     expect(eventJson.content.body).toEqual('matrix.svg');

  //     expect(media.info.mimeType).toEqual('image/svg+xml');
  //     expect(media.info.filename).toEqual('matrix.svg');
  //     expect(media.file).toEqual(TEST_FILE);
  // });
});
