import { test as baseTest } from "./util/fixtures";
import { E2ETestMatrixClient } from "./util/e2e-test";
import { describe, expect, afterEach } from "vitest";
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

const test = baseTest.override("testEnvOpts", ({ webhooksPort }) => ({
  config: {
    generic: {
      enabled: true,
      outbound: true,
      urlPrefix: `http://localhost:${webhooksPort}`,
    },
  },
}));

describe("OutboundHooks", () => {
  let server: Server;

  afterEach(() => {
    try {
      server.close();
    } catch {
      // Ignore, we tried.
    }
  });

  test("should be able to create a new webhook and push an event.", async ({
    testEnv,
    user,
  }) => {
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

  test("should be able to create a new webhook and push a media attachment.", async ({
    testEnv,
    user,
  }) => {
    const roomId = await user.createRoom({ name: "My Test Webhooks room" });
    server = await createHttpServer();
    const gotWebhookRequest = awaitOutboundWebhook(server);
    await createOutboundConnection(user, testEnv.botMxid, roomId, server);

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
});
