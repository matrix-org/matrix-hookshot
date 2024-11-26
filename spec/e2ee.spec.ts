import { MessageEventContent } from "matrix-bot-sdk";
import { E2ESetupTestTimeout, E2ETestEnv } from "./util/e2e-test";
import { describe, it, beforeEach, afterEach } from "@jest/globals";

const CryptoRoomState = [{
    content: {
        "algorithm": "m.megolm.v1.aes-sha2"
    },
    state_key: "",
    type: "m.room.encryption"
}];

describe('End-2-End Encryption support', () => {
    let testEnv: E2ETestEnv;

    beforeEach(async () => {
        testEnv = await E2ETestEnv.createTestEnv({ matrixLocalparts: ['user'], enableE2EE: true });
        await testEnv.setUp();
    }, E2ESetupTestTimeout);

    afterEach(() => {
        return testEnv?.tearDown();
    });

    it('should be able to send the help command', async () => {
        const user = testEnv.getUser('user');
        const testRoomId = await user.createRoom({ name: 'Test room', invite:[testEnv.botMxid], initial_state: CryptoRoomState});
        await user.setUserPowerLevel(testEnv.botMxid, testRoomId, 50);
        await user.waitForRoomJoin({sender: testEnv.botMxid, roomId: testRoomId });
        await user.sendText(testRoomId, "!hookshot help");
        await user.waitForRoomEvent<MessageEventContent>({
            eventType: 'm.room.message', sender: testEnv.botMxid, roomId: testRoomId,
        });
    });
    it('should send notices in an encrypted format', async () => {
        const user = testEnv.getUser('user');
        const testRoomId = await user.createRoom({ name: 'Test room', invite:[testEnv.botMxid], initial_state: CryptoRoomState});
        await user.setUserPowerLevel(testEnv.botMxid, testRoomId, 50);
        await user.waitForRoomJoin({sender: testEnv.botMxid, roomId: testRoomId });
        await user.sendText(testRoomId, "!hookshot webhook test-webhook");
        const inviteResponse = await user.waitForRoomInvite({sender: testEnv.botMxid});
        await user.waitForEncryptedEvent<MessageEventContent>({
            eventType: 'm.room.message', sender: testEnv.botMxid, roomId: testRoomId,
            body: 'Room configured to bridge webhooks. See admin room for secret url.'
        });
        const webhookUrlMessage = user.waitForEncryptedEvent<MessageEventContent>({
            eventType: 'm.room.message', sender: testEnv.botMxid, roomId: inviteResponse.roomId
        });
        await user.joinRoom(inviteResponse.roomId);
        const msgData = (await webhookUrlMessage).data.content.body;
        const webhookUrl = msgData.split('\n')[2];
        const webhookNotice = user.waitForEncryptedEvent<MessageEventContent>({
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
