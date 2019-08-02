import { BridgeConfig } from "./Config";
import { Application, default as express, Request, Response } from "express";
import { createHmac } from "crypto";
import { IssuesGetResponse, ReposGetResponse, IssuesGetResponseUser, IssuesGetCommentResponse } from "@octokit/rest";
import { EventEmitter } from "events";

export interface IWebhookEvent {
    action: string;
    issue?: IssuesGetResponse, // more or less
    comment?: IssuesGetCommentResponse,
    repository?: ReposGetResponse,
    sender?: IssuesGetResponseUser,
}

export class GithubWebhooks extends EventEmitter {
    private expressApp: Application;
    constructor(private config: BridgeConfig) {
        super();
        this.expressApp = express();
        this.expressApp.use(express.json({
            verify: this.verifyRequest.bind(this),
        }));
        this.expressApp.post("/", this.onPayload.bind(this));
    }

    listen() {
        this.expressApp.listen(
            this.config.github.webhook.port,
            this.config.github.webhook.bindAddress
        );
    }

    onPayload(req: Request, res: Response) {
        const body = req.body as IWebhookEvent;
        console.log("Got", body.action);
        try {
            console.log(body);
            if (body.action === "created" && body.comment) {
                this.emit(`comment.created`, body);
            } else {
                this.emit(`${body.action}`, body);
            }
        } catch (ex) {
            console.error("Failed to emit");
        }
        res.sendStatus(200);
    }

    onEvent() {

    }

    // Calculate the X-Hub-Signature header value.
    private getSignature (buf: Buffer) {
        var hmac = createHmac("sha1", this.config.github.webhook.secret);
        hmac.update(buf);
        return "sha1=" + hmac.digest("hex");
    }
  
    // Verify function compatible with body-parser to retrieve the request payload.
    // Read more: https://github.com/expressjs/body-parser#verify
    private verifyRequest (req: Request, res: Response, buf: Buffer) {
        const expected = req.headers['x-hub-signature'];
        const calculated = this.getSignature(buf);
        if (expected !== calculated) {
            res.sendStatus(403);
            throw new Error("Invalid signature.");
        }
        return true;
    }
}