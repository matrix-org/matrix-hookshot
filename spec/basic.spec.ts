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
});
