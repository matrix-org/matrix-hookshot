import { MessageQueue } from "../MessageQueue";
import express, { NextFunction, Request, Response, Router } from "express";
import { Logger } from "matrix-appservice-bridge";
import { ApiError, ErrCode } from "../api";
import { GenericWebhookEvent, GenericWebhookEventResult } from "./types";
import * as xml from "xml2js";
import helmet, { crossOriginOpenerPolicy } from "helmet";

const WEBHOOK_RESPONSE_TIMEOUT = 5000;

const log = new Logger('GenericWebhooksRouter');
export class GenericWebhooksRouter {
    constructor(private readonly queue: MessageQueue, private readonly deprecatedPath = false, private readonly allowGet: boolean) { }

    private onWebhook(req: Request<{hookId: string}, unknown, unknown, unknown>, res: Response<unknown|{ok: false, error: string}>, next: NextFunction) {
        if (req.method === "GET" && !this.allowGet) {
            throw new ApiError("Invalid Method. Expecting PUT or POST", ErrCode.MethodNotAllowed);
        }

        if (!['PUT', 'GET', 'POST'].includes(req.method)) {
            throw new ApiError("Invalid Method. Expecting PUT, GET or POST", ErrCode.MethodNotAllowed);
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
                const body = response.response?.body ?? {ok: true};
                if (response.response?.contentType) {
                    res.contentType(response.response.contentType);
                }
                res.status(response.response?.statusCode ?? 200).send(body);
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

    private static xmlHandler(req: Request, res: Response, next: NextFunction) {
        express.text({ type: ["*/xml", "+xml"] })(req, res, (err) => {
            if (err) {
                next(err);
                return;
            }
            if (typeof req.body !== 'string') {
                next();
                return;
            }
            xml.parseStringPromise(req.body).then(xmlResult => {
                req.body = xmlResult;
                next();
            }).catch(e => {
                res.statusCode = 400;
                next(e);
            });
        });
    }

    public getRouter() {
        const router = Router();
        router.all(
            '/:hookId',
            helmet({
                contentSecurityPolicy: {
                    useDefaults: true,
                    directives: {
                        defaultSrc: "'self'",
                        sandbox: ''
                    }
                },
                xFrameOptions: { action: 'deny'},
                crossOriginResourcePolicy: { policy: 'same-site'} ,
            }),
            GenericWebhooksRouter.xmlHandler,
            express.urlencoded({ extended: false }),
            express.json(),
            express.text({ type: 'text/*'}),
            this.onWebhook.bind(this),
        );
        return router;
    }
}
