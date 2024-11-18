import { E2ESetupTestTimeout, E2ETestEnv, E2ETestMatrixClient } from "./util/e2e-test";
import { describe, it } from "@jest/globals";
import { GenericHookConnection } from "../src/Connections";
import { TextualMessageEventContent } from "matrix-bot-sdk";
import { add } from "date-fns/add";

async function createInboundConnection(user: E2ETestMatrixClient, botMxid: string, roomId: string, duration?: string) {
    const join = user.waitForRoomJoin({ sender: botMxid, roomId });
    const connectionEvent = user.waitForRoomEvent({
        eventType: GenericHookConnection.CanonicalEventType,
        stateKey: 'test',
        sender: botMxid
    });
    await user.inviteUser(botMxid, roomId);
    await user.setUserPowerLevel(botMxid, roomId, 50);
    await join;

    // Note: Here we create the DM proactively so this works across multiple
    // tests.
    // Get the DM room so we can get the token.
    const dmRoomId = await user.dms.getOrCreateDm(botMxid);

    await user.sendText(roomId, '!hookshot webhook test' + (duration ? ` ${duration}` : ""));
    // Test the contents of this.
    await connectionEvent;

    const msgPromise = user.waitForRoomEvent({ sender: botMxid, eventType: "m.room.message", roomId: dmRoomId });
    const { data: msgData } =  await msgPromise;
    const msgContent = msgData.content as unknown as TextualMessageEventContent;
    const [_unused1, _unused2, url] = msgContent.body.split('\n');
    return url;
}

describe('Inbound (Generic) Webhooks', () => {
    let testEnv: E2ETestEnv;

    beforeAll(async () => {
        const webhooksPort = 9500 + E2ETestEnv.workerId;
        testEnv = await E2ETestEnv.createTestEnv({
            matrixLocalparts: ['user'],
            config: {
                generic: {
                    enabled: true,
                    // Prefer to wait for complete as it reduces the concurrency of the test.
                    waitForComplete: true,
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

    afterAll(() => {
        return testEnv?.tearDown();
    });

    it('should be able to create a new webhook and handle an incoming request.', async () => {
        const user = testEnv.getUser('user');
        const roomId = await user.createRoom({ name: 'My Test Webhooks room'});
        const okMsg = user.waitForRoomEvent({ eventType: "m.room.message", sender: testEnv.botMxid, roomId });
        const url = await createInboundConnection(user, testEnv.botMxid, roomId);
        expect((await okMsg).data.content.body).toEqual('Room configured to bridge webhooks. See admin room for secret url.');

        const expectedMsg = user.waitForRoomEvent({ eventType: "m.room.message", sender: testEnv.botMxid, roomId });
        const req = await fetch(url, {
            method: "PUT",
            body: "Hello world"
        });
        expect(req.status).toEqual(200);
        expect(await req.json()).toEqual({ ok: true });
        expect((await expectedMsg).data.content).toEqual({
            msgtype: 'm.notice',
            body: 'Received webhook data: Hello world',
            formatted_body: '<p>Received webhook data: Hello world</p>',
            format: 'org.matrix.custom.html',
            'uk.half-shot.hookshot.webhook_data': 'Hello world'
        });
    });

    it('should be able to create a new expiring webhook and handle valid requests.', async () => {
        jest.useFakeTimers();
        const user = testEnv.getUser('user');
        const roomId = await user.createRoom({ name: 'My Test Webhooks room'});
        const okMsg = user.waitForRoomEvent({ eventType: "m.room.message", sender: testEnv.botMxid, roomId });
        const url = await createInboundConnection(user, testEnv.botMxid, roomId, '2h');
        expect((await okMsg).data.content.body).toEqual('Room configured to bridge webhooks. See admin room for secret url.');

        const expectedMsg = user.waitForRoomEvent({ eventType: "m.room.message", sender: testEnv.botMxid, roomId });
        const req = await fetch(url, {
            method: "PUT",
            body: "Hello world"
        });
        expect(req.status).toEqual(200);
        expect(await req.json()).toEqual({ ok: true });
        expect((await expectedMsg).data.content).toEqual({
            msgtype: 'm.notice',
            body: 'Received webhook data: Hello world',
            formatted_body: '<p>Received webhook data: Hello world</p>',
            format: 'org.matrix.custom.html',
            'uk.half-shot.hookshot.webhook_data': 'Hello world'
        });
        jest.setSystemTime(add(new Date(), { hours: 3 }));
        const expiredReq = await fetch(url, {
            method: "PUT",
            body: "Hello world"
        });
        expect(expiredReq.status).toEqual(404);
        expect(await expiredReq.json()).toEqual({
            ok: false,
            error: "This hook has expired",
        });
    });
});
