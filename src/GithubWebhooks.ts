import { BridgeConfig } from "./Config";
import { Application, default as express, Request, Response } from "express";
import { createHmac } from "crypto";
import { IssuesGetResponse, ReposGetResponse, IssuesGetResponseUser, IssuesGetCommentResponse } from "@octokit/rest";
import { EventEmitter } from "events";
import { MessageQueue, createMessageQueue } from "./MessageQueue/MessageQueue";

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
        console.debug("Got", body);
        try {
            if (body.action === "created" && body.comment) {
                this.queue.push({
                    eventName: "comment.created",
                    sender: "GithubWebhooks",
                    data: body,
                });
            } else if (body.action === "edited" && body.comment) {
                this.queue.push({
                    eventName: "comment.edited",
                    sender: "GithubWebhooks",
                    data: body,
                });
            } else if (body.action === "edited" && body.issue) {
                this.queue.push({
                    eventName: "issue.edited",
                    sender: "GithubWebhooks",
                    data: body,
                });
            } else if (body.action === "closed" && body.issue) {
                this.queue.push({
                    eventName: "issue.closed",
                    sender: "GithubWebhooks",
                    data: body,
                });
            } else if (body.action === "reopened" && body.issue) {
                this.queue.push({
                    eventName: "issue.reopened",
                    sender: "GithubWebhooks",
                    data: body,
                });
            }
        } catch (ex) {
            console.error("Failed to emit");
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
