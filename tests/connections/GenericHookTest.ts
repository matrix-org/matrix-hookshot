/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from "chai";
import { BridgeConfigGenericWebhooks, BridgeGenericWebhooksConfigYAML } from "../../src/Config/Config";
import { GenericHookConnection, GenericHookConnectionState } from "../../src/Connections/GenericHook";
import { MessageSenderClient } from "../../src/MatrixSender";
import { createMessageQueue, MessageQueue } from "../../src/MessageQueue";
import { AppserviceMock } from "../utils/AppserviceMock";

const ROOM_ID = "!foo:bar";

const V1TFFunction = "result = `The answer to '${data.question}' is ${data.answer}`;";
const V2TFFunction = "result = {plain: `The answer to '${data.question}' is ${data.answer}`, version: 'v2'}";

function createGenericHook(state: GenericHookConnectionState = {
    name: "some-name"
}, config: BridgeGenericWebhooksConfigYAML = { enabled: true, urlPrefix: "https://example.com/webhookurl"}): [GenericHookConnection, MessageQueue] {
    const mq = createMessageQueue({
        queue: {
            monolithic: true,
        },
    } as any);
    mq.subscribe('*');
    const messageClient = new MessageSenderClient(mq);
    const connection =  new GenericHookConnection(ROOM_ID, state, "foobar", "foobar", messageClient, new BridgeConfigGenericWebhooks(config), AppserviceMock.create())
    return [connection, mq];
}

function handleMessage(mq: MessageQueue) {
    return new Promise(r => mq.on('matrix.message', (msg) => {
        mq.push({
            eventName: 'response.matrix.message',
            messageId: msg.messageId,
            sender: 'TestSender',
            data: { 'eventId': '$foo:bar' },
        });
        r(msg.data);
    })); 
}

describe("GenericHookConnection", () => {
    it("will handle a simple hook event", async () => {
        const webhookData = {simple: "data"};
        const [connection, mq] = createGenericHook();
        const messagePromise = handleMessage(mq);
        await connection.onGenericHook(webhookData);
        expect(await messagePromise).to.deep.equal({
            roomId: ROOM_ID,
            sender: connection.getUserId(),
            content: {
                body: "Received webhook data:\n\n```json\n\n{\n  \"simple\": \"data\"\n}\n\n```",
                format: "org.matrix.custom.html",
                formatted_body: "<p>Received webhook data:</p><p><pre><code class=\\\"language-json\\\">{\n  \"simple\": \"data\"\n}</code></pre></p>",
                msgtype: "m.notice",
                "uk.half-shot.hookshot.webhook_data": webhookData,
            },
            type: 'm.room.message',
        });
    });
    it("will handle a hook event containing text", async () => {
        const webhookData = {text: "simple-message"};
        const [connection, mq] = createGenericHook();
        const messagePromise = handleMessage(mq);
        await connection.onGenericHook(webhookData);
        expect(await messagePromise).to.deep.equal({
            roomId: ROOM_ID,
            sender: connection.getUserId(),
            content: {
                body: "simple-message",
                format: "org.matrix.custom.html",
                formatted_body: "simple-message",
                msgtype: "m.notice",
                "uk.half-shot.hookshot.webhook_data": webhookData,
            },
            type: 'm.room.message',
        });
    });
    it("will handle a hook event containing html", async () => {
        const webhookData = {text: "simple-message", html: "<b>simple-message</b>"};
        const [connection, mq] = createGenericHook();
        const messagePromise = handleMessage(mq);
        await connection.onGenericHook(webhookData);
        expect(await messagePromise).to.deep.equal({
            roomId: ROOM_ID,
            sender: connection.getUserId(),
            content: {
                body: "simple-message",
                format: "org.matrix.custom.html",
                formatted_body: "<b>simple-message</b>",
                msgtype: "m.notice",
                "uk.half-shot.hookshot.webhook_data": webhookData,
            },
            type: 'm.room.message',
        });
    });
    it("will handle a hook event containing a username", async () => {
        const webhookData = {username: "Bobs-integration", type: 42};
        const [connection, mq] = createGenericHook();
        const messagePromise = handleMessage(mq);
        await connection.onGenericHook(webhookData);
        expect(await messagePromise).to.deep.equal({
            roomId: ROOM_ID,
            sender: connection.getUserId(),
            content: {
                body: "**Bobs-integration**: Received webhook data:\n\n```json\n\n{\n  \"username\": \"Bobs-integration\",\n  \"type\": 42\n}\n\n```",
                format: "org.matrix.custom.html",
                formatted_body: "<strong>Bobs-integration</strong>: <p>Received webhook data:</p><p><pre><code class=\\\"language-json\\\">{\n  \"username\": \"Bobs-integration\",\n  \"type\": 42\n}</code></pre></p>",
                msgtype: "m.notice",
                "uk.half-shot.hookshot.webhook_data": webhookData,
            },
            type: 'm.room.message',
        });
    });
    it("will handle a hook event with a v1 transformation function", async () => {
        const webhookData = {question: 'What is the meaning of life?', answer: 42};
        const [connection, mq] = createGenericHook({name: 'test', transformationFunction: V1TFFunction}, {
                enabled: true,
                urlPrefix: "https://example.com/webhookurl",
                allowJsTransformationFunctions: true,
            }
        );
        const messagePromise = handleMessage(mq);
        await connection.onGenericHook(webhookData);
        expect(await messagePromise).to.deep.equal({
            roomId: ROOM_ID,
            sender: connection.getUserId(),
            content: {
                body: "Received webhook: The answer to 'What is the meaning of life?' is 42",
                format: "org.matrix.custom.html",
                formatted_body: "Received webhook: The answer to 'What is the meaning of life?' is 42",
                msgtype: "m.notice",
                "uk.half-shot.hookshot.webhook_data": webhookData,
            },
            type: 'm.room.message',
        });
    });
    it("will handle a hook event with a v2 transformation function", async () => {
        const webhookData = {question: 'What is the meaning of life?', answer: 42};
        const [connection, mq] = createGenericHook({name: 'test', transformationFunction: V2TFFunction}, {
                enabled: true,
                urlPrefix: "https://example.com/webhookurl",
                allowJsTransformationFunctions: true,
            }
        );
        const messagePromise = handleMessage(mq);
        await connection.onGenericHook(webhookData);
        expect(await messagePromise).to.deep.equal({
            roomId: ROOM_ID,
            sender: connection.getUserId(),
            content: {
                body: "The answer to 'What is the meaning of life?' is 42",
                format: "org.matrix.custom.html",
                formatted_body: "The answer to 'What is the meaning of life?' is 42",
                msgtype: "m.notice",
                "uk.half-shot.hookshot.webhook_data": webhookData,
            },
            type: 'm.room.message',
        });
    });
    it("will fail to handle a webhook with an invalid script", async () => {
        const webhookData = {question: 'What is the meaning of life?', answer: 42};
        const [connection, mq] = createGenericHook({name: 'test', transformationFunction: "bibble bobble"}, {
                enabled: true,
                urlPrefix: "https://example.com/webhookurl",
                allowJsTransformationFunctions: true,
            }
        );
        const messagePromise = handleMessage(mq);
        await connection.onGenericHook(webhookData);
        expect(await messagePromise).to.deep.equal({
            roomId: ROOM_ID,
            sender: connection.getUserId(),
            content: {
                body: "Webhook received but failed to process via transformation function",
                format: "org.matrix.custom.html",
                formatted_body: "Webhook received but failed to process via transformation function",
                msgtype: "m.notice",
                "uk.half-shot.hookshot.webhook_data": webhookData,
            },
            type: 'm.room.message',
        });
    });
})
