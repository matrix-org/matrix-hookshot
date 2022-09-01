import express from "express";
import { GenericWebhooksRouter } from "../../src/generic/Router"; 
import { errorMiddleware } from "../../src/api";
import LogWrapper from "../../src/LogWrapper";
import { expect } from "chai";
import { LocalMQ } from "../../src/MessageQueue/LocalMQ";
import { Server } from "node:http";
import fetch, { Headers } from 'node-fetch';
import { StatusCodes } from "http-status-codes";
import { MessageQueueMessage } from "../../src/MessageQueue";
import { GenericWebhookEvent } from "../../src/generic/types";
import querystring from 'node:querystring';

const PORT = 12345;

const makeRequest = async(method: string, path: string, body: string, headers: Record<string, string> = {}) => {
    const req = await fetch(`http://localhost:${PORT}${path}`,{
        method,
        headers: new Headers(headers),
        body,
    });
    return {
        data: await req.json(),
        status: req.status,
        headers: req.headers,
    };
}

const waitForWebhookEvent = function (mq: LocalMQ): Promise<MessageQueueMessage<GenericWebhookEvent>> {
    return new Promise((resolve) => mq.on('generic-webhook.event', (d: MessageQueueMessage<GenericWebhookEvent>) => {
        resolve(d);
    }));
}

describe("GenericWebhooksRouter", () => {
    let mq: LocalMQ;
    let srv: Server;
    beforeEach(() => {
        mq = new LocalMQ();
        const app = express();
        app.use(new GenericWebhooksRouter(mq, false, false).getRouter());
        app.use(
            errorMiddleware(new LogWrapper('TestWrapper'))
        );
        srv = app.listen(12345);
    });
    

    afterEach(() =>{
        srv.close();
    })

    it("should handle unknown webhook IDs", async () => {
        const webhookEvent = waitForWebhookEvent(mq);
        const responsePromise = makeRequest('POST', '/foo', 'some-data');
        const { messageId } = await webhookEvent;
        mq.push({
            messageId,
            eventName: 'response.generic-webhook.event',
            data: { 
                notFound: true,
            },
            sender: 'test',
        });
        const response = await responsePromise;
        expect(response.status).to.equal(StatusCodes.NOT_FOUND);
        expect(response.data).to.deep.equal({
            error: "Webhook not found",
            ok: false
        });
    });

    it("should handle a unsuccessful webhook", async () => {
        const webhookEvent = waitForWebhookEvent(mq);
        const responsePromise = makeRequest('POST', '/foo', 'some-data');
        const { messageId } = await webhookEvent;
        mq.push({
            messageId,
            eventName: 'response.generic-webhook.event',
            data: { 
                successful: false,
            },
            sender: 'test',
        });
        const response = await responsePromise;
        expect(response.status).to.equal(StatusCodes.INTERNAL_SERVER_ERROR);
        expect(response.data).to.deep.equal({
            ok: false,
            error: 'Failed to process webhook',
        });
    });

    it("should handle a deferred webhook", async () => {
        const webhookEvent = waitForWebhookEvent(mq);
        const responsePromise = makeRequest('POST', '/foo', 'some-data');
        const { messageId } = await webhookEvent;
        mq.push({
            messageId,
            eventName: 'response.generic-webhook.event',
            data: { },
            sender: 'test',
        });
        const response = await responsePromise;
        expect(response.status).to.equal(StatusCodes.ACCEPTED);
        expect(response.data).to.deep.equal({
            ok: true,
        });
    });

    it("should handle an XML payload", async () => {
        const webhookEvent = waitForWebhookEvent(mq);
        const responsePromise = makeRequest('POST', '/foo', '<helloworld>bar</helloworld>', {
            'Content-Type': 'text/xml',
        });
        const { messageId, data } = await webhookEvent;
        expect(data.hookId).to.equal('foo');
        expect(data.hookData).to.deep.equal({
            helloworld: 'bar',
        });
        mq.push({
            messageId,
            eventName: 'response.generic-webhook.event',
            data: {
                successful: true,
            },
            sender: 'test',
        });
        const response = await responsePromise;
        expect(response.status).to.equal(StatusCodes.OK);
        expect(response.data).to.deep.equal({
            ok: true,
        });
    });

    it("should handle a URL encoded payload", async () => {
        const webhookEvent = waitForWebhookEvent(mq);
        const responsePromise = makeRequest('POST', '/foo',
            querystring.stringify({helloworld: 'bar'}), {
            'Content-Type': 'application/x-www-form-urlencoded',
        });
        const { messageId, data } = await webhookEvent;
        expect(data.hookId).to.equal('foo');
        expect(data.hookData).to.deep.equal({
            helloworld: 'bar',
        });
        mq.push({
            messageId,
            eventName: 'response.generic-webhook.event',
            data: {
                successful: true,
            },
            sender: 'test',
        });
        const response = await responsePromise;
        expect(response.status).to.equal(StatusCodes.OK);
        expect(response.data).to.deep.equal({
            ok: true,
        });
    });

    it("should handle a JSON encoded payload", async () => {
        const webhookEvent = waitForWebhookEvent(mq);
        const responsePromise = makeRequest('POST', '/foo',
            JSON.stringify({helloworld: 'bar'}), {
            'Content-Type': 'application/json',
        });
        const { messageId, data } = await webhookEvent;
        expect(data.hookId).to.equal('foo');
        expect(data.hookData).to.deep.equal({
            helloworld: 'bar',
        });
        mq.push({
            messageId,
            eventName: 'response.generic-webhook.event',
            data: {
                successful: true,
            },
            sender: 'test',
        });
        const response = await responsePromise;
        expect(response.status).to.equal(StatusCodes.OK);
        expect(response.data).to.deep.equal({
            ok: true,
        });
    });

    it("should handle a text payload", async () => {
        const webhookEvent = waitForWebhookEvent(mq);
        const responsePromise = makeRequest('POST', '/foo',
            'Some text',
            {
                'Content-Type': 'text/foo',
            }
        );
        const { messageId, data } = await webhookEvent;
        expect(data.hookId).to.equal('foo');
        expect(data.hookData).to.equal('Some text');
        mq.push({
            messageId,
            eventName: 'response.generic-webhook.event',
            data: {
                successful: true,
            },
            sender: 'test',
        });
        const response = await responsePromise;
        expect(response.status).to.equal(StatusCodes.OK);
        expect(response.data).to.deep.equal({
            ok: true,
        });
    });

    it("should handle PUT requests", async () => {
        const webhookEvent = waitForWebhookEvent(mq);
        const responsePromise = makeRequest('PUT', '/foo',
            'Some text',
            {
                'Content-Type': 'text/foo',
            }
        );
        const { messageId, data } = await webhookEvent;
        expect(data.hookId).to.equal('foo');
        expect(data.hookData).to.equal('Some text');
        mq.push({
            messageId,
            eventName: 'response.generic-webhook.event',
            data: {
                successful: true,
            },
            sender: 'test',
        });
        const response = await responsePromise;
        expect(response.status).to.equal(StatusCodes.OK);
        expect(response.data).to.deep.equal({
            ok: true,
        });
    });

    it("should ignore all other payload types", async () => {
        const webhookEvent = waitForWebhookEvent(mq);
        const responsePromise = makeRequest('POST', '/foo',
            'Some text',
            {
                'Content-Type': 'application/octet-stream',
            }
        );
        const { messageId, data } = await webhookEvent;
        expect(data.hookId).to.equal('foo');
        expect(data.hookData).to.deep.equal({});
        mq.push({
            messageId,
            eventName: 'response.generic-webhook.event',
            data: {
                successful: true,
            },
            sender: 'test',
        });
        const response = await responsePromise;
        expect(response.status).to.equal(StatusCodes.OK);
        expect(response.data).to.deep.equal({
            ok: true,
        });
    });

});