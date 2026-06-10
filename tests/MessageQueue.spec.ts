import { describe, it, expect } from "vitest";
import { createMessageQueue } from "../src/messageQueue/MessageQueue";

const mq = createMessageQueue();

describe("MessageQueueTest", () => {
  describe("LocalMq", () => {
    it("should be able to push an event, and listen for it", () => new Promise<void>((resolve) => {
      mq.subscribe("fakeevent");
      mq.on("fakeevent", (msg) => {
        expect(msg).toEqual({
          sender: "foo",
          eventName: "fakeevent",
          messageId: "foooo",
          data: 51,
        });
        resolve();
      });
      mq.push<number>({
        sender: "foo",
        eventName: "fakeevent",
        messageId: "foooo",
        data: 51,
      });
    }));

    it("should be able to push an event, and respond to it", async () => {
      mq.subscribe("fakeevent2");
      mq.subscribe("response.fakeevent2");
      mq.on("fakeevent2", async (msg) => {
        expect(msg).toEqual({
          sender: "foo",
          eventName: "fakeevent2",
          messageId: "foooo",
          data: 49,
        });
        await mq.push<string>({
          sender: "foo",
          eventName: "response.fakeevent2",
          messageId: "foooo",
          data: "worked",
        });
      });
      const response = await mq.pushWait<number, string>({
        sender: "foo",
        eventName: "fakeevent2",
        messageId: "foooo",
        data: 49,
      });
      expect(response).toBe("worked");
    });
  });
});
