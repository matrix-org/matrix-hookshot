import { Router } from "express";
import { GenericWebhooksRouter } from "../../src/generic/Router"; 
import { createRequest, createResponse as mockCreateResponse } from 'node-mocks-http';
import { errorMiddleware } from "../../src/api";
import LogWrapper from "../../src/LogWrapper";
import { EventEmitter } from "stream";
import { expect } from "chai";
import { LocalMQ } from "../../src/MessageQueue/LocalMQ";

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

    it("should handle a missing hook", (done) => {
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
            expect(res._getStatusCode()).to.equal(404);
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
            expect(res._getStatusCode()).to.equal(500);
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
            expect(res._getStatusCode()).to.equal(202);
            expect(res._getData()).to.deep.equal({
                ok: true,
            })
            done();
        });
    });
});