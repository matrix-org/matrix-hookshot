/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from "chai";
import { MatrixError } from "matrix-bot-sdk";
import { BridgeConfigGenericWebhooks, BridgeGenericWebhooksConfigYAML } from "../../src/config/Config";
import { GenericHookConnection, GenericHookConnectionState } from "../../src/Connections/GenericHook";
import { MessageSenderClient, IMatrixSendMessage } from "../../src/MatrixSender";
import { LocalMQ } from "../../src/MessageQueue/LocalMQ";
import { AppserviceMock } from "../utils/AppserviceMock";

const ROOM_ID = "!foo:bar";

const V1TFFunction = "result = `The answer to '${data.question}' is ${data.answer}`;";
const V2TFFunction = "result = {plain: `The answer to '${data.question}' is ${data.answer}`, version: 'v2'}";
const V2TFFunctionWithReturn = "result = {plain: `The answer to '${data.question}' is ${data.answer}`, version: 'v2'}; return;";

async function testSimpleWebhook(connection: GenericHookConnection, mq: LocalMQ, testValue: string) {
    const webhookData = {simple: testValue};
    const messagePromise = handleMessage(mq);
    await connection.onGenericHook(webhookData);
    expect(await messagePromise).to.deep.equal({
        roomId: ROOM_ID,
        sender: connection.getUserId(),
        content: {
            body: "Received webhook data:\n\n```json\n\n{\n  \"simple\": \"" + testValue + "\"\n}\n\n```",
            format: "org.matrix.custom.html",
            formatted_body: "<p>Received webhook data:</p><p><pre><code class=\\\"language-json\\\">{\n  \"simple\": \"" + testValue + "\"\n}</code></pre></p>",
            msgtype: "m.notice",
            "uk.half-shot.hookshot.webhook_data": webhookData,
        },
        type: 'm.room.message',
    });
}

function createGenericHook(
    state: Partial<GenericHookConnectionState> = { },
    config: BridgeGenericWebhooksConfigYAML = { enabled: true, urlPrefix: "https://example.com/webhookurl"}
) {
    const mq = new LocalMQ();
    mq.subscribe('*');
    const messageClient = new MessageSenderClient(mq);
    const as = AppserviceMock.create();
    const intent = as.getIntentForUserId('@webhooks:example.test');
    const connection =  new GenericHookConnection(ROOM_ID, {
        name: "some-name",
        transformationFunction: undefined,
        waitForComplete: undefined,
        ...state,
    }, "foobar", "foobar", messageClient, new BridgeConfigGenericWebhooks(config), as, intent);
    return [connection, mq, as, intent];
}

function handleMessage(mq: LocalMQ): Promise<IMatrixSendMessage> {
    return new Promise(r => mq.once('matrix.message', (msg) => {
        mq.push({
            eventName: 'response.matrix.message',
            messageId: msg.messageId,
            sender: 'TestSender',
            data: { 'eventId': '$foo:bar' },
        });
        r(msg.data as IMatrixSendMessage);
    }));
}

describe("GenericHookConnection", () => {
    before(async () => {
        await GenericHookConnection.initialiseQuickJS();
    })
    it("will handle simple hook events", async () => {
        const [connection, mq] = createGenericHook();
        await testSimpleWebhook(connection, mq, "data");
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
                formatted_body: "<p>simple-message</p>",
                msgtype: "m.notice",
                "uk.half-shot.hookshot.webhook_data": webhookData,
            },
            type: 'm.room.message',
        });
    });
    it("will handle a hook event containing markdown", async () => {
        const webhookData = {text: "**bold-message** _italic-message_"};
        const [connection, mq] = createGenericHook();
        const messagePromise = handleMessage(mq);
        await connection.onGenericHook(webhookData);
        expect(await messagePromise).to.deep.equal({
            roomId: ROOM_ID,
            sender: connection.getUserId(),
            content: {
                body: "**bold-message** _italic-message_",
                format: "org.matrix.custom.html",
                formatted_body: "<p><strong>bold-message</strong> <em>italic-message</em></p>",
                msgtype: "m.notice",
                "uk.half-shot.hookshot.webhook_data": webhookData,
            },
            type: 'm.room.message',
        });
    });
    it("will handle a hook event containing markdown with newlines", async () => {
        const webhookData = {text: "# Oh wow\n\n`some-code`"};
        const [connection, mq] = createGenericHook();
        const messagePromise = handleMessage(mq);
        await connection.onGenericHook(webhookData);
        expect(await messagePromise).to.deep.equal({
            roomId: ROOM_ID,
            sender: connection.getUserId(),
            content: {
                body: "# Oh wow\n\n`some-code`",
                format: "org.matrix.custom.html",
                formatted_body: "<h1>Oh wow</h1>\n<p><code>some-code</code></p>",
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
                formatted_body: "<p>Received webhook: The answer to 'What is the meaning of life?' is 42</p>",
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
                formatted_body: "<p>The answer to 'What is the meaning of life?' is 42</p>",
                msgtype: "m.notice",
                "uk.half-shot.hookshot.webhook_data": webhookData,
            },
            type: 'm.room.message',
        });
    });
    it("will handle a hook event with a top-level return", async () => {
        const webhookData = {question: 'What is the meaning of life?', answer: 42};
        const [connection, mq] = createGenericHook({name: 'test', transformationFunction: V2TFFunctionWithReturn}, {
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
                formatted_body: "<p>The answer to 'What is the meaning of life?' is 42</p>",
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
                formatted_body: "<p>Webhook received but failed to process via transformation function</p>",
                msgtype: "m.notice",
                "uk.half-shot.hookshot.webhook_data": webhookData,
            },
            type: 'm.room.message',
        });
    });
    it("will handle a message containing floats", async () => {
        const [connection, mq] = createGenericHook();
        let messagePromise = handleMessage(mq);
        await connection.onGenericHook({ simple: 1.2345 });
        let message = await messagePromise;
        expect(message.roomId).to.equal(ROOM_ID);
        expect(message.sender).to.equal(connection.getUserId());
        expect(message.content["uk.half-shot.hookshot.webhook_data"]).to.deep.equal({ simple: "1.2345" });

        messagePromise = handleMessage(mq);
        await connection.onGenericHook({
            a: {
                deep: {
                    object: {
                        containing: 1.2345
                    }
                }
            }
        });
        message = await messagePromise;
        expect(message.roomId).to.equal(ROOM_ID);
        expect(message.sender).to.equal(connection.getUserId());
        expect(message.content["uk.half-shot.hookshot.webhook_data"]).to.deep.equal({ a: { deep: { object: { containing: "1.2345" }}} });

        messagePromise = handleMessage(mq);
        await connection.onGenericHook({
            an_array_of: [1.2345, 6.789],
            floats: true,
        });
        message = await messagePromise;
        expect(message.roomId).to.equal(ROOM_ID);
        expect(message.sender).to.equal(connection.getUserId());
        expect(message.content["uk.half-shot.hookshot.webhook_data"]).to.deep.equal({
            an_array_of: ["1.2345", "6.789"],
            floats: true,
        });
    });

    it("should handle simple hook events with user Id prefix", async () => {
        const config = { enabled: true, urlPrefix: "https://example.com/webhookurl", userIdPrefix: "_webhooks_"};
        const [connection, mq] = createGenericHook(undefined, config);
        await testSimpleWebhook(connection, mq, "data1");
        // regression test covering https://github.com/matrix-org/matrix-hookshot/issues/625
        await testSimpleWebhook(connection, mq, "data2");
    });

    it("should invite a configured puppet to the room if it's unable to join", async () => {
        const senderUserId = "@_webhooks_some-name:example.test";
        const config = { enabled: true, urlPrefix: "https://example.com/webhookurl", userIdPrefix: "_webhooks_"};
        const [connection, mq, as, botIntent] = createGenericHook(undefined, config);
        const intent = as.getIntentForUserId(senderUserId);
        let hasInvited = false;

        // This should fail the first time, then pass once we've tried to invite the user
        intent.ensureJoined = (roomId: string) => {
            if (hasInvited) {
                return;
            }
            expect(roomId).to.equal(ROOM_ID);
            throw new MatrixError({ errcode: "M_FORBIDDEN", error: "Test forced error"}, 401)
        };

        // This should invite the puppet user.
        botIntent.underlyingClient.inviteUser = (userId: string, roomId: string) => {
            expect(userId).to.equal(senderUserId);
            expect(roomId).to.equal(ROOM_ID);
            hasInvited = true;
        }

        // regression test covering https://github.com/matrix-org/matrix-hookshot/issues/625
        await testSimpleWebhook(connection, mq, "data1");
        // Only pass if we've actually bothered to invite the bot.
        expect(hasInvited).to.be.true;
    });

    it("should fail a message if a bot cannot join a room", async () => {
        const senderUserId = "@_webhooks_some-name:example.test";
        const config = { enabled: true, urlPrefix: "https://example.com/webhookurl", userIdPrefix: "_webhooks_"};
        const [connection, mq, as] = createGenericHook(undefined, config);
        const intent = as.getIntentForUserId(senderUserId);

        // This should fail the first time, then pass once we've tried to invite the user
        intent.ensureJoined = () => {
            throw new MatrixError({ errcode: "FORCED_FAILURE", error: "Test forced error"}, 500)
        };
        try {
            // regression test covering https://github.com/matrix-org/matrix-hookshot/issues/625
            await testSimpleWebhook(connection, mq, "data1");
        } catch (ex) {
            expect(ex.message).to.contain(`Could not ensure that ${senderUserId} is in ${ROOM_ID}`)
        }
    });
})
