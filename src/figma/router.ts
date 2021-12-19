import { BridgeConfigFigma } from "../Config/Config";
import { MessageQueue } from "../MessageQueue";
import { Request, Response, Router } from "express";
import { FigmaPayload } from "./types";
import LogWrapper from "../LogWrapper";

const log = new LogWrapper('FigmaWebhooksRouter');

export class FigmaWebhooksRouter {
    constructor(private readonly config: BridgeConfigFigma, private readonly queue: MessageQueue) { }

    private onWebhook(req: Request<unknown, unknown, FigmaPayload, unknown>, res: Response<string|{error: string}>) {
        const payload = req.body;
        const instance = this.config.instances.find(p => p.webhookPasscode === payload.passcode);
        if (!instance) {
            // No instance found
            res.sendStatus(401);
            return;
        }
        if (typeof payload.file_name !== "string" || typeof payload.file_key !== "string") {
            res.status(400).send({error: "Missing required object keys file_name, file_key"});
            return;
        }
        res.status(200);
        this.queue.push({
            eventName: 'figma.payload',
            data: payload,
            sender: 'GithubWebhooks',
        })
    }

    public getRouter() {
        const router = Router();
        router.get("/webhook", this.onWebhook.bind(this));
        return router;
    }
}
