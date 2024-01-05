import { BridgeConfigFigma } from "../config/Config";
import { MessageQueue } from "../MessageQueue";
import { Request, Response, Router, json } from "express";
import { FigmaPayload } from "./types";
import { Logger } from "matrix-appservice-bridge";

const log = new Logger('FigmaWebhooksRouter');

export class FigmaWebhooksRouter {
    constructor(private readonly config: BridgeConfigFigma, private readonly queue: MessageQueue) { }

    private onWebhook(req: Request<unknown, unknown, FigmaPayload, unknown>, res: Response<string|{error: string}>) {
        const payload = req.body;
        const instance = Object.entries(this.config.instances).find(([,p]) => p.passcode === payload.passcode);
        log.debug(`Got figma webhook for instance ${instance?.[0]}`);
        if (!instance) {
            // No instance found
            res.sendStatus(401);
            return;
        }
        if (typeof payload.file_name !== "string" || typeof payload.file_key !== "string") {
            res.status(400).send({error: "Missing required object keys file_name, file_key"});
            return;
        }
        res.status(200).send();
        this.queue.push({
            eventName: 'figma.payload',
            data: {
                payload,
                instanceName: instance[0],
            },
            sender: 'GithubWebhooks',
        })
    }

    public getRouter() {
        const router = Router();
        router.use(json());
        router.post("/webhook", this.onWebhook.bind(this));
        return router;
    }
}
