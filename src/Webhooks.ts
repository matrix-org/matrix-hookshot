import { BridgeConfig } from "./Config/Config";
import { Application, default as express, Request, Response } from "express";
import { EventEmitter } from "events";
import { MessageQueue, createMessageQueue } from "./MessageQueue/MessageQueue";
import LogWrapper from "./LogWrapper";
import qs from "querystring";
import { Server } from "http";
import axios from "axios";
import { IGitLabWebhookEvent } from "./Gitlab/WebhookTypes";
import { EmitterWebhookEvent, Webhooks as OctokitWebhooks } from "@octokit/webhooks"
const log = new LogWrapper("GithubWebhooks");

export interface OAuthRequest {
    code: string;
    state: string;
}

export interface OAuthTokens {
    // eslint-disable-next-line camelcase
    access_token: string;
    // eslint-disable-next-line camelcase
    token_type: string;
    state: string;
}

export interface NotificationsEnableEvent {
    userId: string;
    roomId: string;
    since: number;
    token: string;
    filterParticipating: boolean;
    type: "github"|"gitlab";
    instanceUrl?: string;
}

export interface NotificationsDisableEvent {
    userId: string;
    type: "github"|"gitlab";
    instanceUrl?: string;
}

export class Webhooks extends EventEmitter {
    private expressApp: Application;
    private queue: MessageQueue;
    private server?: Server;
    private ghWebhooks?: OctokitWebhooks;
    constructor(private config: BridgeConfig) {
        super();
        this.expressApp = express();
        if (this.config.github?.webhook.secret) {
            this.ghWebhooks = new OctokitWebhooks({
                secret: config.github?.webhook.secret as string,
            });
            this.ghWebhooks.onAny(e => this.onGitHubPayload(e));
        }

        this.expressApp.use(express.json({
            verify: this.verifyRequest.bind(this),
        }));
        this.expressApp.post("/", this.onPayload.bind(this));
        this.expressApp.get("/oauth", this.onGetOauth.bind(this));
        this.queue = createMessageQueue(config);
    }

    public listen() {
        this.server = this.expressApp.listen(
            this.config.webhook.port,
            this.config.webhook.bindAddress,
        );
        log.info(`Listening on http://${this.config.webhook.bindAddress}:${this.config.webhook.port}`);
    }

    public stop() {
        if (this.queue.stop) {
            this.queue.stop();
        } 
        if (this.server) {
            this.server.close();
        }
    }

    private onGitLabPayload(body: IGitLabWebhookEvent) {
        log.info(`onGitLabPayload ${body.event_type}:`, body);
        if (body.event_type === "merge_request") {
            return `gitlab.merge_request.${body.object_attributes.action}`;
        } else if (body.event_type === "issue") {
            return `gitlab.issue.${body.object_attributes.action}`;
        } else if (body.event_type === "note") {
            return `gitlab.note.created`;
        } else {
            return null;
        }
    }

    private async onGitHubPayload({id, name, payload}: EmitterWebhookEvent) {
        log.info(`Got GitHub webhook event ${id} ${name}`);
        console.log(payload);
        const action = (payload as unknown as {action: string|undefined}).action;
        try {
            await this.queue.push({
                eventName: `github.${name}${action ? `.${action}` : ""}`,
                sender: "Webhooks",
                data: payload,
            });
        } catch (err) {
            log.error(`Failed to emit payload ${id}: ${err}`);
        }
    }

    private onPayload(req: Request, res: Response) {
        log.debug(`New webhook: ${req.url}`);
        try {
            let eventName: string|null = null;
            const body = req.body;
            if (req.headers['x-hub-signature']) {
                if (!this.ghWebhooks) {
                    log.warn(`Not configured for GitHub webhooks, but got a GitHub event`)
                    res.sendStatus(500);
                    return;
                }
                res.sendStatus(200);
                this.ghWebhooks.verifyAndReceive({
                    id: req.headers["x-github-delivery"] as string,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    name: req.headers["x-github-event"] as any,
                    payload: body,
                    signature: req.headers["x-hub-signature-256"] as string,
                }).catch((err) => {
                    log.error(`Failed handle GitHubEvent: ${err}`);
                });
                return;
            } else if (req.headers['x-gitlab-token']) {
                res.sendStatus(200);
                eventName = this.onGitLabPayload(body);
            }
            if (eventName) {
                this.queue.push({
                    eventName,
                    sender: "GithubWebhooks",
                    data: body,
                }).catch((err) => {
                    log.error(`Failed to emit payload: ${err}`);
                });
            } else {
                log.debug("Unknown event:", req.body);
            }
        } catch (ex) {
            log.error("Failed to emit message", ex);
        }
    }

    public async onGetOauth(req: Request, res: Response) {
        log.info("Got new oauth request");
        try {
            if (!this.config.github) {
                throw Error("Got GitHub oauth request but github was not configured!");
            }
            const exists = await this.queue.pushWait<OAuthRequest, boolean>({
                eventName: "oauth.response",
                sender: "GithubWebhooks",
                data: {
                    code: req.query.code as string,
                    state: req.query.state as string,
                },
            });
            if (!exists) {
                res.status(404).send(`<p>Could not find user which authorised this request. Has it timed out?</p>`);
                return;
            }
            const accessTokenRes = await axios.post(`https://github.com/login/oauth/access_token?${qs.encode({
                client_id: this.config.github.oauth.client_id,
                client_secret: this.config.github.oauth.client_secret,
                code: req.query.code as string,
                redirect_uri: this.config.github.oauth.redirect_uri,
                state: req.query.state as string,
            })}`);
            // eslint-disable-next-line camelcase
            const result = qs.parse(accessTokenRes.data) as { access_token: string, token_type: string };
            await this.queue.push<OAuthTokens>({
                eventName: "oauth.tokens",
                sender: "GithubWebhooks",
                data: { state: req.query.state as string, ... result },
            });
            res.send(`<p> Your account has been bridged </p>`);
        } catch (ex) {
            log.error("Failed to handle oauth request:", ex);
            res.status(500).send(`<p>Encountered an error handing oauth request</p>`);
        }
    }

    private verifyRequest(req: Request, res: Response) {
        if (req.headers['x-gitlab-token']) {
            // GitLab
            if (!this.config.gitlab) {
                log.error("Got a GitLab webhook, but the bridge is not set up for it.");
                res.sendStatus(400);
                throw Error('Not expecting a gitlab request!');
            }
            if (req.headers['x-gitlab-token'] === this.config.gitlab.webhook.secret) {
                log.debug('Verified GitLab request');
                return true;
            } else {
                log.error(`${req.url} had an invalid signature`);
                res.sendStatus(403);
                throw Error("Invalid signature.");
            }
        } else if (req.headers["x-hub-signature"]) {
            // GitHub
            // Verified within handler.
            return true;
        }
        log.error(`No signature on URL. Rejecting`);
        res.sendStatus(400);
        throw Error("Invalid signature.");
    }
}
