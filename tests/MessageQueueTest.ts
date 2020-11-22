import { expect } from "chai";
import { createMessageQueue } from "../src/MessageQueue/MessageQueue";

const mq = createMessageQueue({
    queue: {
        monolithic: true,
    },
// tslint:disable-next-line: no-any
} as any);

describe("MessageQueueTest", () => {
    describe("LocalMq", () => {
        it("should be able to push an event, and listen for it", async (done) => {
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
            await mq.push<number>({
                sender: "foo",
                eventName: "fakeevent",
                messageId: "foooo",
                data: 51,
                ts: 0,
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
                    ts: 0,
                });
            });
            const response = await mq.pushWait<number, string>({
                sender: "foo",
                eventName: "fakeevent2",
                messageId: "foooo",
                data: 49,
                ts: 0,
            });
            expect(response).to.equal("worked");
        });
    });
});
