import { MessageQueue } from "../MessageQueue";
import express, { NextFunction, Request, Response, Router } from "express";
import LogWrapper from "../LogWrapper";
import { ApiError, ErrCode } from "../api";
import { GenericWebhookEvent, GenericWebhookEventResult } from "./types";

const WEBHOOK_RESPONSE_TIMEOUT = 5000;

const log = new LogWrapper('GenericWebhooksRouter');
export class GenericWebhooksRouter {
    constructor(private readonly queue: MessageQueue, private readonly deprecatedPath = false) { }

    private onWebhook(req: Request<{hookId: string}, unknown, unknown, unknown>, res: Response<{ok: true}|{ok: false, error: string}>, next: NextFunction) {
        if (!['PUT', 'GET', 'POST'].includes(req.method)) {
            throw new ApiError("Wrong METHOD. Expecting PUT, GET or POST", ErrCode.MethodNotAllowed);
        }
    
        let body;
        if (req.method === 'GET') {
            body = req.query;
        } else {
            body = req.body;
        }
    
        this.queue.pushWait<GenericWebhookEvent, GenericWebhookEventResult>({
            eventName: 'generic-webhook.event',
            sender: "GithubWebhooks",
            data: {
                hookData: body,
                hookId: req.params.hookId,
            },
        }, WEBHOOK_RESPONSE_TIMEOUT).then((response) => {
            if (response.notFound) {
                if (this.deprecatedPath) {
                    // If the webhook wasn't found and we're on a deprecated path, ignore it.
                    next();
                    return;
                }
                res.status(404).send({ok: false, error: "Webhook not found"});
            } else if (response.successful) {
                res.status(200).send({ok: true});
            } else if (response.successful === false) {
                res.status(500).send({ok: false, error: "Failed to process webhook"});
            } else {
                res.status(202).send({ok: true});
            }
        }).catch((err) => {
            log.error(`Failed to emit payload: ${err}`);
            res.status(500).send({ok: false, error: "Failed to handle webhook"});
        });
    }

    public getRouter() {
        const router = Router();
        router.all(
            '/:hookId',
            express.text({ type: 'text/*'}),
            express.urlencoded({ extended: false }),
            express.json(),
            this.onWebhook.bind(this),
        );
        return router;
    }
}
