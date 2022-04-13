import { BridgeConfig } from "./Config/Config";
import { Router, default as express, Request, Response } from "express";
import { EventEmitter } from "events";
import { MessageQueue, createMessageQueue } from "./MessageQueue";
import LogWrapper from "./LogWrapper";
import qs from "querystring";
import axios from "axios";
import { IGitLabWebhookEvent, IGitLabWebhookIssueStateEvent, IGitLabWebhookMREvent, IGitLabWebhookReleaseEvent } from "./Gitlab/WebhookTypes";
import { EmitterWebhookEvent, Webhooks as OctokitWebhooks } from "@octokit/webhooks"
import { IJiraWebhookEvent } from "./Jira/WebhookTypes";
import { JiraWebhooksRouter } from "./Jira/Router";
import { OAuthRequest } from "./WebhookTypes";
import { GitHubOAuthTokenResponse } from "./Github/Types";
import Metrics from "./Metrics";
import { FigmaWebhooksRouter } from "./figma/router";
import { GenericWebhooksRouter } from "./generic/Router";

const log = new LogWrapper("Webhooks");

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
    
    public readonly expressRouter = Router();
    private queue: MessageQueue;
    private ghWebhooks?: OctokitWebhooks;
    constructor(private config: BridgeConfig) {
        super();
        this.expressRouter.use((req, _res, next) => {
            Metrics.webhooksHttpRequest.inc({path: req.path, method: req.method});
            next();
        });
        if (this.config.github?.webhook.secret) {
            this.ghWebhooks = new OctokitWebhooks({
                secret: config.github?.webhook.secret as string,
            });
            this.ghWebhooks.onAny(e => this.onGitHubPayload(e));
        }

        // TODO: Move these
        this.expressRouter.get("/oauth", this.onGitHubGetOauth.bind(this));
        this.queue = createMessageQueue(config);
        if (this.config.jira) {
            this.expressRouter.use("/jira", new JiraWebhooksRouter(this.queue).getRouter());
        }
        if (this.config.figma) {
            this.expressRouter.use('/figma', new FigmaWebhooksRouter(this.config.figma, this.queue).getRouter());
        }
        if (this.config.generic) {
            this.expressRouter.use('/webhook', new GenericWebhooksRouter(this.queue).getRouter());
            // TODO: Remove old deprecated endpoint
            this.expressRouter.use(new GenericWebhooksRouter(this.queue, true).getRouter());
        }
        this.expressRouter.use(express.json({
            verify: this.verifyRequest.bind(this),
        }));
        this.expressRouter.post("/", this.onPayload.bind(this));
    }

    public stop() {
        if (this.queue.stop) {
            this.queue.stop();
        }
    }

    private onGitLabPayload(body: IGitLabWebhookEvent) {
        if (body.object_kind === "merge_request") {
            const action = (body as unknown as IGitLabWebhookMREvent).object_attributes.action;
            return `gitlab.merge_request.${action}`;
        } else if (body.object_kind === "issue") {
            const action = (body as unknown as IGitLabWebhookIssueStateEvent).object_attributes.action;
            return `gitlab.issue.${action}`;
        } else if (body.object_kind === "note") {
            return `gitlab.note.created`;
        } else if (body.object_kind === "tag_push") {
            return "gitlab.tag_push";
        } else if (body.object_kind === "wiki_page") {
            return "gitlab.wiki_page";
        } else if (body.object_kind === "release") {
            const action = (body as unknown as IGitLabWebhookReleaseEvent).action;
            return `gitlab.release.${action}`;
        } else if (body.object_kind === "push") {
            return `gitlab.push`;
        } else {
            return null;
        }
    }

    private onJiraPayload(body: IJiraWebhookEvent) {
        const webhookEvent = body.webhookEvent.replace("jira:", "");
        log.debug(`onJiraPayload ${webhookEvent}:`, body);
        return `jira.${webhookEvent}`;
    }

    private async onGitHubPayload({id, name, payload}: EmitterWebhookEvent) {
        const action = (payload as unknown as {action: string|undefined}).action;
        const eventName =  `github.${name}${action ? `.${action}` : ""}`;
        log.info(`Got GitHub webhook event ${id} ${eventName}`);
        log.debug("Payload:", payload);
        try {
            await this.queue.push({
                eventName,
                sender: "Webhooks",
                data: payload,
            });
        } catch (err) {
            log.error(`Failed to emit payload ${id}: ${err}`);
        }
    }

    private onPayload(req: Request, res: Response) {
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
            } else if (JiraWebhooksRouter.IsJIRARequest(req)) {
                res.sendStatus(200);
                eventName = this.onJiraPayload(body);
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

    public async onGitHubGetOauth(req: Request<unknown, unknown, unknown, {error?: string, error_description?: string, code?: string, state?: string}> , res: Response) {
        log.info(`Got new oauth request for ${req.query.state}`);
        try {
            if (!this.config.github || !this.config.github.oauth) {
                return res.status(500).send(`<p>Bridge is not configured with OAuth support</p>`);
            }
            if (req.query.error) {
                return res.status(500).send(`<p><b>GitHub Error</b>: ${req.query.error} ${req.query.error_description}</p>`);
            }
            if (!req.query.state) {
                return res.status(400).send(`<p>Missing state</p>`);
            }
            if (!req.query.code) {
                return res.status(400).send(`<p>Missing code</p>`);
            }
            const exists = await this.queue.pushWait<OAuthRequest, boolean>({
                eventName: "github.oauth.response",
                sender: "GithubWebhooks",
                data: {
                    state: req.query.state,
                },
            });
            if (!exists) {
                return res.status(404).send(`<p>Could not find user which authorised this request. Has it timed out?</p>`);
            }
            const accessTokenRes = await axios.post(`https://github.com/login/oauth/access_token?${qs.encode({
                client_id: this.config.github.oauth.client_id,
                client_secret: this.config.github.oauth.client_secret,
                code: req.query.code as string,
                redirect_uri: this.config.github.oauth.redirect_uri,
                state: req.query.state as string,
            })}`);
            // eslint-disable-next-line camelcase
            const result = qs.parse(accessTokenRes.data) as GitHubOAuthTokenResponse|{error: string, error_description: string, error_uri: string};
            if ("error" in result) {
                return res.status(500).send(`<p><b>GitHub Error</b>: ${result.error} ${result.error_description}</p>`);
            }
            await this.queue.push<GitHubOAuthTokenResponse>({
                eventName: "github.oauth.tokens",
                sender: "GithubWebhooks",
                data: { ...result, state: req.query.state as string },
            });
            return res.send(`<p> Your account has been bridged </p>`);
        } catch (ex) {
            log.error("Failed to handle oauth request:", ex);
            return res.status(500).send(`<p>Encountered an error handing oauth request</p>`);
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
        } else if (JiraWebhooksRouter.IsJIRARequest(req)) {
            // JIRA
            if (!this.config.jira) {
                log.error("Got a JIRA webhook, but the bridge is not set up for it.");
                res.sendStatus(400);
                throw Error('Not expecting a jira request!');
            }
            if (req.query.secret !== this.config.jira.webhook.secret) {
                log.error(`${req.url} had an invalid signature`);
                res.sendStatus(403);
                throw Error("Invalid signature.");
            }
            return true;
        }
        log.error(`No signature on URL. Rejecting`);
        res.sendStatus(400);
        throw Error("Invalid signature.");
    }
}
