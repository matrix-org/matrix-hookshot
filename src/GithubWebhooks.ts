import { BridgeConfig } from "./Config";
import { Application, default as express, Request, Response } from "express";
import { createHmac } from "crypto";
import { IssuesGetResponse, ReposGetResponse, IssuesGetResponseUser, IssuesGetCommentResponse } from "@octokit/rest";
import { EventEmitter } from "events";
import { MessageQueue, createMessageQueue } from "./MessageQueue/MessageQueue";
import { LogWrapper } from "./LogWrapper";

const log = new LogWrapper("GithubWebhooks");

export interface IWebhookEvent {
    action: string;
    issue?: IssuesGetResponse;
    comment?: IssuesGetCommentResponse;
    repository?: ReposGetResponse;
    sender?: IssuesGetResponseUser;
    changes?: {
        title?: {
            from: string;
        };
    };
}

export class GithubWebhooks extends EventEmitter {
    private expressApp: Application;
    private queue: MessageQueue;
    constructor(private config: BridgeConfig) {
        super();
        this.expressApp = express();
        this.expressApp.use(express.json({
            verify: this.verifyRequest.bind(this),
        }));
        this.expressApp.post("/", this.onPayload.bind(this));
        this.queue = createMessageQueue(config);
    }

    public listen() {
        this.expressApp.listen(
            this.config.github.webhook.port,
            this.config.github.webhook.bindAddress,
        );
    }

    public onPayload(req: Request, res: Response) {
        const body = req.body as IWebhookEvent;
        log.debug("Got", body);
        let eventName;
        let from;
        if (body.sender) {
            from = body.sender.login;
        }
        try {
            if (body.action === "created" && body.comment) {
                eventName = "comment.created";
            } else if (body.action === "edited" && body.comment) {
                eventName = "comment.edited";
            } else if (body.action === "edited" && body.issue) {
                eventName = "issue.edited";
            } else if (body.action === "closed" && body.issue) {
                eventName = "issue.closed";
            } else if (body.action === "reopened" && body.issue) {
                eventName = "issue.reopened";
            }
            if (eventName) {
                log.info(`Got event ${eventName} ${from ? "from " + from : ""}`);
                this.queue.push({
                    eventName,
                    sender: "GithubWebhooks",
                    data: body,
                });
            }
        } catch (ex) {
            log.error("Failed to emit");
        }
        res.sendStatus(200);
    }

    // Calculate the X-Hub-Signature header value.
    private getSignature(buf: Buffer) {
        const hmac = createHmac("sha1", this.config.github.webhook.secret);
        hmac.update(buf);
        return "sha1=" + hmac.digest("hex");
    }

    // Verify function compatible with body-parser to retrieve the request payload.
    // Read more: https://github.com/expressjs/body-parser#verify
    private verifyRequest(req: Request, res: Response, buf: Buffer) {
        const expected = req.headers["x-hub-signature"];
        const calculated = this.getSignature(buf);
        if (expected !== calculated) {
            res.sendStatus(403);
            throw new Error("Invalid signature.");
        }
        return true;
    }
}
