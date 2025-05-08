import { Request, Response, Router, json } from "express";
import { Logger } from "matrix-appservice-bridge";
import { BridgeOpenProjectConfig } from "../config/sections/openproject";
import { MessageQueue } from "../MessageQueue";
import { OpenProjectWebhookPayload, OpenProjectWebhookPayloadWorkPackage } from "./types";
import { ApiError, ErrCode } from "../api";
import { createHmac } from "node:crypto";

export class OpenProjectWebhooksRouter {

    public static IsRequest(req: Request): boolean {
        if (req.headers['x-atlassian-webhook-identifier']) {
            return true; // Cloud
        } else if (req.headers['user-agent']?.match(/JIRA/)) {
            return true; // JIRA On-prem
        }
        return false;
    }

    constructor(private readonly config: BridgeOpenProjectConfig, private readonly queue: MessageQueue) {

    }

    /**
     * Verifies a JIRA webhook request for a valid secret or signature.
     * @throws If the request is invalid
     * @param req The express request.
     */
    public verifyWebhookRequest(req: Request, _res: never, buffer: Buffer): void {
        const signature = req.headers['x-op-signature']?.slice('sha1='.length);
        if (!signature) {
            throw new ApiError("No signature provided on request", ErrCode.BadToken);
        }

        const calculatedSecret = createHmac('sha1', this.config.webhookSecret).update(buffer).digest('hex');
        if (signature !== calculatedSecret) {
            throw new ApiError("Signature did not match", ErrCode.BadToken);
        }
        return;
    }


    private onWebhook(req: Request<unknown, unknown, OpenProjectWebhookPayload, unknown>, res: Response<string|{error: string}>) {
        const payload = req.body;
        res.status(200).send();
        this.queue.push({
            eventName: `openproject.${payload.action}`,
            data: payload,
            sender: 'GithubWebhooks',
        })
    }

    public getRouter() {
        const router = Router();
        router.use(json({ verify: this.verifyWebhookRequest.bind(this)}));
        router.post("/webhook", this.onWebhook.bind(this));
        return router;
    }
}