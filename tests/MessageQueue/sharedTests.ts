import { expect } from "chai";
import { createMessageQueue, MessageQueue, MessageQueueMessageOut } from "../../src/MessageQueue";

let mq: MessageQueue;

const sharedTests: ([string, () => Promise<void>])[] = [
	["should be able to push an event, and listen for it", async () => {
		mq.subscribe("fakeevent");
		const msgPromise = new Promise<MessageQueueMessageOut<unknown>>(r => mq.on("fakeevent", (msg) => r(msg)));
		const p = mq.push<number>({
			sender: "foo",
			eventName: "fakeevent",
			messageId: "foooo",
			data: 51,
		});
		const msg = await msgPromise;
		expect(msg.ts).to.be.greaterThan(0);
		expect(msg.sender).to.deep.equal('foo');
		expect(msg.eventName).to.deep.equal('fakeevent');
		expect(msg.messageId).to.deep.equal('foooo');
		expect(msg.data).to.deep.equal(51);
		await p;
	}],
	["should be able to push an event, and respond to it", async () => {
		mq.subscribe("fakeevent2");
		mq.subscribe("response.fakeevent2");
		const msgPromise = new Promise<MessageQueueMessageOut<unknown>>(r => mq.on("fakeevent2", (msg) => r(msg)));
		const response = mq.pushWait<number, string>({
			sender: "foo",
			eventName: "fakeevent2",
			messageId: "foooo",
			data: 49,
		});

		const msg = await msgPromise;
		expect(msg.ts).to.be.greaterThan(0);
		expect(msg.sender).to.deep.equal('foo');
		expect(msg.eventName).to.deep.equal('fakeevent2');
		expect(msg.messageId).to.deep.equal('foooo');
		expect(msg.data).to.deep.equal(49);
		await mq.push<string>({
			sender: "foo",
			eventName: "response.fakeevent2",
			messageId: "foooo",
			data: "worked",
		});

		expect(await response).to.equal("worked");
	}],
]

describe("MessageQueue", () => {
    describe("MonolithMessageQueue", () => {
		beforeEach(() => {
			mq = createMessageQueue({
				monolithic: true
			});
		})
		for (const test of sharedTests) {
			it(test[0], test[1]);
		}
    });

	const describeFn = process.env.TEST_REDIS_QUEUE_HOST ? describe : xdescribe;
    describeFn("RedisMessageQueue", () => {
		before(() => {
			mq = createMessageQueue({
				monolithic: false,
				host: process.env.TEST_REDIS_QUEUE_HOST,
			});
		})
		after(() => {
			mq.stop?.();
		})
		for (const test of sharedTests) {
			it(test[0], test[1]);
		}
    });
});
