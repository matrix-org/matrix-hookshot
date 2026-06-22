import { MessageEventContent } from "matrix-bot-sdk";
import { test } from "./util/fixtures";
import { expect, describe } from "vitest";

describe("Basic test setup", () => {
  test("should be able to invite the bot to a room", async ({
    testEnv,
    user,
  }) => {
    const roomId = await user.createRoom({
      name: "Test room",
      invite: [testEnv.botMxid],
    });
    await user.waitForRoomJoin({ sender: testEnv.botMxid, roomId });
    const msg = user.waitForRoomEvent<MessageEventContent>({
      eventType: "m.room.message",
      sender: testEnv.botMxid,
      roomId,
    });
    await user.sendText(roomId, "!hookshot help");
    // Expect help text.
    expect((await msg).data.content.body).to.include(
      "!hookshot help` - This help text\n",
    );
  });
});
