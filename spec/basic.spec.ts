import { MessageEventContent } from "matrix-bot-sdk";
import { E2ESetupTestTimeout, E2ETestEnv } from "./util/e2e-test";
import { describe, it, beforeEach, afterEach } from "@jest/globals";
import { expect } from "chai";

describe('Basic test setup', () => {
    let testEnv: E2ETestEnv;

    beforeEach(async () => {
        testEnv = await E2ETestEnv.createTestEnv({matrixLocalparts: ['user']});
        await testEnv.setUp();
    }, E2ESetupTestTimeout);

    afterEach(() => {
        return testEnv?.tearDown();
    });

    it('should be able to invite the bot to a room', async () => {
        const user = testEnv.getUser('user');
        const roomId = await user.createRoom({ name: 'Test room', invite:[testEnv.botMxid] });
        await user.waitForRoomJoin({sender: testEnv.botMxid, roomId });
        const msg = user.waitForRoomEvent<MessageEventContent>({
            eventType: 'm.room.message', sender: testEnv.botMxid, roomId
        });
        await user.sendText(roomId, "!hookshot help");
        // Expect help text.
        expect((await msg).data.content.body).to.include('!hookshot help` - This help text\n');
    });

    // TODO: Move test to it's own generic connections file.
    it('should be able to setup a webhook', async () => {
        const user = testEnv.getUser('user');
        const testRoomId = await user.createRoom({ name: 'Test room', invite:[testEnv.botMxid] });
        await user.waitForRoomJoin({sender: testEnv.botMxid, roomId: testRoomId });
        await user.setUserPowerLevel(testEnv.botMxid, testRoomId, 50);
        await user.sendText(testRoomId, "!hookshot webhook test-webhook");
        const inviteResponse = await user.waitForRoomInvite({sender: testEnv.botMxid});
        await user.waitForRoomEvent<MessageEventContent>({
            eventType: 'm.room.message', sender: testEnv.botMxid, roomId: testRoomId,
            body: 'Room configured to bridge webhooks. See admin room for secret url.'
        });
        const webhookUrlMessage = user.waitForRoomEvent<MessageEventContent>({
            eventType: 'm.room.message', sender: testEnv.botMxid, roomId: inviteResponse.roomId
        });
        await user.joinRoom(inviteResponse.roomId);
        const msgData = (await webhookUrlMessage).data.content.body;
        const webhookUrl = msgData.split('\n')[2];
        const webhookNotice = user.waitForRoomEvent<MessageEventContent>({
            eventType: 'm.room.message', sender: testEnv.botMxid, roomId: testRoomId, body: 'Hello world!'
        });

        // Send a webhook
        await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({text: 'Hello world!'})
        });

        // And await the notice.
        await webhookNotice;
    });
});
