import { TextualMessageEventContent } from "matrix-bot-sdk";
import { GenericHookConnection } from "../../src/Connections";
import { E2ETestMatrixClient } from "./e2e-test";

export async function waitFor(
  condition: () => Promise<boolean>,
  delay = 100,
  maxRetries = 10,
) {
  let retries = 0;
  while (!(await condition()) && retries++ < maxRetries) {
    await new Promise((r) => setTimeout(r, delay));
  }
  if (retries === maxRetries) {
    throw Error("Hit retry limit");
  }
}

export async function createInboundConnection(
  user: E2ETestMatrixClient,
  botMxid: string,
  roomId: string,
  duration?: string,
) {
  const join = user.waitForRoomJoin({ sender: botMxid, roomId });
  const connectionEvent = user.waitForRoomEvent({
    eventType: GenericHookConnection.CanonicalEventType,
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

  await user.sendText(
    roomId,
    "!hookshot webhook test" + (duration ? ` ${duration}` : ""),
  );
  // Test the contents of this.
  await connectionEvent;

  const msgPromise = user.waitForRoomEvent({
    sender: botMxid,
    eventType: "m.room.message",
    roomId: dmRoomId,
  });
  const { data: msgData } = await msgPromise;
  const msgContent = msgData.content as unknown as TextualMessageEventContent;
  const [_unused1, _unused2, url] = msgContent.body.split("\n");
  return url;
}
