import { expect } from "chai";
import { createMessageQueue } from "../src/MessageQueue/MessageQueue";

const mq = createMessageQueue();

describe("MessageQueueTest", () => {
    describe("LocalMq", () => {
        it("should be able to push an event, and listen for it", (done) => {
            mq.subscribe("fakeevent");
            mq.on("fakeevent", (msg) => {
                expect(msg).to.deep.equal({
                    sender: "foo",
                    eventName: "fakeevent",
                    messageId: "foooo",
                    data: 51,
                });
                done();
            });
            mq.push<number>({
                sender: "foo",
                eventName: "fakeevent",
                messageId: "foooo",
                data: 51,
            });
        });
        it("should be able to push an event, and respond to it", async () => {
            mq.subscribe("fakeevent2");
            mq.subscribe("response.fakeevent2");
            mq.on("fakeevent2", async (msg) => {
                expect(msg).to.deep.equal({
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
            expect(response).to.equal("worked");
        });
    });
});
