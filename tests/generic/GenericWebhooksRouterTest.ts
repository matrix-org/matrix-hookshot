import { Router } from "express";
import { GenericWebhooksRouter } from "../../src/generic/Router"; 
import { createRequest, createResponse as mockCreateResponse } from 'node-mocks-http';
import { errorMiddleware } from "../../src/api";
import LogWrapper from "../../src/LogWrapper";
import { EventEmitter } from "stream";
import { expect } from "chai";
import { LocalMQ } from "../../src/MessageQueue/LocalMQ";
import { StatusCodes } from "http-status-codes";
import querystring from 'node:querystring';

const createResponse = () => mockCreateResponse({
    eventEmitter: EventEmitter,
})

const NEXT  = () => { /* Do nothing */ }

describe("GenericWebhooksRouter", () => {
    let mq: LocalMQ;
    let router: Router;
    beforeEach(() => {
        mq = new LocalMQ();
        router = new GenericWebhooksRouter(mq, false, false).getRouter().use(
            errorMiddleware(new LogWrapper('TestWrapper'))
        );
    })

    it("should handle unknown webhook IDs", (done) => {
        mq.on('generic-webhook.event', (d) => {
            mq.push({
                messageId: d.messageId,
                eventName: 'response.generic-webhook.event',
                data: { 
                    notFound: true,
                },
                sender: 'test',
            });
        });
        const req = createRequest({ url: "/foo", method: "POST" });
        const res = createResponse();
        router(req, res, NEXT);
        res.on('end', () => {
            expect(res._getStatusCode()).to.equal(StatusCodes.NOT_FOUND);
            expect(res._getData()).to.deep.equal({
                ok: false,
                error: 'Webhook not found',
            })
            done();
        });
    });

    it("should handle a unsuccessful webhook", (done) => {
        mq.on('generic-webhook.event', (d) => {
            mq.push({
                messageId: d.messageId,
                eventName: 'response.generic-webhook.event',
                data: { 
                    successful: false,
                },
                sender: 'test',
            });
        });
        const req = createRequest({ url: "/foo", method: "POST" });
        const res = createResponse();
        router(req, res, NEXT);
        res.on('end', () => {
            expect(res._getStatusCode()).to.equal(StatusCodes.INTERNAL_SERVER_ERROR);
            expect(res._getData()).to.deep.equal({
                ok: false,
                error: 'Failed to process webhook',
            })
            done();
        });
    });

    it("should handle a deferred webhook", (done) => {
        mq.on('generic-webhook.event', (d) => {
            mq.push({
                messageId: d.messageId,
                eventName: 'response.generic-webhook.event',
                data: { },
                sender: 'test',
            });
        });
        const req = createRequest({ url: "/foo", method: "POST" });
        const res = createResponse();
        router(req, res, NEXT);
        res.on('end', () => {
            expect(res._getStatusCode()).to.equal(StatusCodes.ACCEPTED);
            expect(res._getData()).to.deep.equal({
                ok: true,
            })
            done();
        });
    });

    it("should handle an XML payload", (done) => {
        mq.on('generic-webhook.event', ({data, messageId}) => {
            expect(data.hookId).to.equal('foo');
            expect(data.hookData).to.deep.equal({
                helloworld: 'bar',
            });
            mq.push({
                messageId: messageId,
                eventName: 'response.generic-webhook.event',
                data: {
                    successful: true,
                },
                sender: 'test',
            });
        });
        const req = createRequest({ url: "/foo", method: "POST" });
        req.body = '<helloworld>bar</helloworld>';
        const res = createResponse();
        router(req, res, NEXT);
        res.on('end', () => {
            expect(res._getStatusCode()).to.equal(StatusCodes.OK);
            expect(res._getData()).to.deep.equal({
                ok: true,
            })
            done();
        });
    });
    it("should handle a URL encoded payload", (done) => {
        mq.on('generic-webhook.event', ({data, messageId}) => {
            expect(data.hookId).to.equal('foo');
            expect(data.hookData).to.deep.equal({
                helloworld: 'bar',
            });
            mq.push({
                messageId: messageId,
                eventName: 'response.generic-webhook.event',
                data: {
                    successful: true,
                },
                sender: 'test',
            });
        });
        const req = createRequest({ url: "/foo", method: "POST", headers: {
            'content-type': 'application/x-www-form-urlencoded',
        } });
        req.body = querystring.stringify({helloworld: 'bar'});
        const res = createResponse();
        router(req, res, NEXT);
        res.on('end', () => {
            expect(res._getStatusCode()).to.equal(StatusCodes.OK);
            expect(res._getData()).to.deep.equal({
                ok: true,
            })
            done();
        });
    });
});