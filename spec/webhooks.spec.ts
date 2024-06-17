import { E2ESetupTestTimeout, E2ETestEnv } from "./util/e2e-test";
import { describe, it, beforeEach, afterEach } from "@jest/globals";
import { OutboundHookConnection } from "../src/Connections";
import { TextualMessageEventContent } from "matrix-bot-sdk";
import { IncomingHttpHeaders, createServer } from "http";
import busboy, { FileInfo } from "busboy";

describe('OutboundHooks', () => {
    let testEnv: E2ETestEnv;

    beforeEach(async () => {
        const webhooksPort = 9500 + E2ETestEnv.workerId;
        testEnv = await E2ETestEnv.createTestEnv({
            matrixLocalparts: ['user'],
            config: {
                generic: {
                    enabled: true,
                    urlPrefix: `http://localhost:${webhooksPort}`
                },
                listeners: [{
                    port: webhooksPort,
                    bindAddress: '0.0.0.0',
                    // Bind to the SAME listener to ensure we don't have conflicts.
                    resources: ['webhooks'],
                }],
            }
        });
        await testEnv.setUp();
    }, E2ESetupTestTimeout);

    afterEach(() => {
        return testEnv?.tearDown();
    });

    it('should be able to create a new webhook and push an event.', async () => {
        const user = testEnv.getUser('user');
        const roomId = await user.createRoom({ name: 'My Test Webhooks room'});
        const join = user.waitForRoomJoin({ sender: testEnv.botMxid, roomId });
        const connectionEvent = user.waitForRoomEvent({
            eventType: OutboundHookConnection.CanonicalEventType,
            stateKey: 'test',
            sender: testEnv.botMxid
        });
        await user.inviteUser(testEnv.botMxid, roomId);
        await user.setUserPowerLevel(testEnv.botMxid, roomId, 50);
        await join;

        // Get the DM room so we can get the token.
        const dmRoom = user.waitForRoomInvite({
            sender: testEnv.botMxid
        });
        await user.sendText(roomId, '!hookshot outbound-hook test http://localhost:8111/test-path');
        // Test the contents of this.
        await connectionEvent;

        const {roomId: dmRoomId} = await dmRoom;
        const msgPromise = user.waitForRoomEvent({ sender: testEnv.botMxid, eventType: "m.room.message", roomId: dmRoomId });
        await user.joinRoom(dmRoomId);
        const { data: msgData } =  await msgPromise;

        const [_match, token ] = /<code>(.+)<\/code>/.exec((msgData.content as unknown as TextualMessageEventContent).formatted_body ?? "") ?? [];

        const gotWebhookRequest = new Promise<{headers: IncomingHttpHeaders, files: {name: string, file: Buffer, info: FileInfo}[]}>((resolve, reject) => {
            const server = createServer((req, res) => {
                const bb = busboy({headers: req.headers});
                const files: {name: string, file: Buffer, info: FileInfo}[] = [];
                bb.on('file', (name, stream, info) => {
                    const buffers: Buffer[] = [];
                    stream.on('data', d => {
                        buffers.push(d)
                    });
                    stream.once('close', () => {
                        files.push({name, info, file: Buffer.concat(buffers)})
                    });
                });

                bb.once('close', () => {
                    res.writeHead(200, { 'Content-Type': 'text/plain' });
                    res.end('OK');
                    resolve({
                        headers: req.headers,
                        files,
                    });
                    clearTimeout(timer);
                    server.close();
                });

                req.pipe(bb);
            });
            server.listen(8111);
            let timer: NodeJS.Timeout;
            timer = setTimeout(() => {
                reject(new Error("Request did not arrive"));
                server.close();
            }, 10000);

        });

        const eventId = await user.sendText(roomId, 'hello!');
        const { headers, files } = await gotWebhookRequest;
        expect(headers['x-matrix-hookshot-roomid']).toEqual(roomId);
        expect(headers['x-matrix-hookshot-eventid']).toEqual(eventId);
        expect(headers['x-matrix-hookshot-token']).toEqual(token);

        // And check the JSON payload
        const [event, media] = files;
        expect(event.name).toEqual('event');
        expect(event.info.mimeType).toEqual('application/json');
        expect(event.info.filename).toEqual('event_data.json');
        const eventJson = JSON.parse(event.file.toString('utf-8'));
        console.log(eventJson);

        // Check that the content looks sane.
        expect(eventJson.room_id).toEqual(roomId);
        expect(eventJson.event_id).toEqual(eventId);
        expect(eventJson.sender).toEqual(await user.getUserId());
        expect(eventJson.content.body).toEqual('hello!');

        // No media should be present.
        expect(media).toBeUndefined();
    });

    // it('should be able to create a new webhook and push a media attachment.', async () => {

    // });

    // it('should be able to create a new webhook and push an encrypted media attachment.', async () => {

    // });
});
