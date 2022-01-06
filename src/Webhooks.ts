import { BridgeConfig } from "./Config/Config";
import { Router, default as express, Request, Response } from "express";
import { EventEmitter } from "events";
import { MessageQueue, createMessageQueue } from "./MessageQueue";
import LogWrapper from "./LogWrapper";
import qs from "querystring";
import { Server } from "http";
import axios from "axios";
import { IGitLabWebhookEvent } from "./Gitlab/WebhookTypes";
import { EmitterWebhookEvent, Webhooks as OctokitWebhooks } from "@octokit/webhooks"
import { IJiraWebhookEvent } from "./Jira/WebhookTypes";
import { JiraWebhooksRouter } from "./Jira/Router";
import { OAuthRequest } from "./WebhookTypes";
import { GitHubOAuthTokenResponse } from "./Github/Types";
import Metrics from "./Metrics";
import { FigmaWebhooksRouter } from "./figma/router";
const log = new LogWrapper("GithubWebhooks");

export interface GenericWebhookEvent {
    hookData: Record<string, unknown>;
    hookId: string;
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
        this.expressRouter.all(
            '/:hookId',
            express.json({ type: ['application/json', 'application/x-www-form-urlencoded'] }),
            this.onGenericPayload.bind(this),
        );

        this.expressRouter.use(express.json({
            verify: this.verifyRequest.bind(this),
        }));
        this.expressRouter.post("/", this.onPayload.bind(this));
        this.queue = createMessageQueue(config);
        if (this.config.jira) {
            this.expressRouter.use("/jira", new JiraWebhooksRouter(this.config.jira, this.queue).getRouter());
        }
        if (this.config.figma) {
            this.expressApp.use('/figma', new FigmaWebhooksRouter(this.config.figma, this.queue).getRouter());
        }
        this.queue = createMessageQueue(config);
    }

    public stop() {
        if (this.queue.stop) {
            this.queue.stop();
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
        } else if (body.object_kind === "tag_push") {
            return "gitlab.tag_push";
        } else if (body.object_kind === "wiki_page") {
            return "gitlab.wiki_page";
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

    private onGenericPayload(req: Request, res: Response) {
        if (!['PUT', 'GET', 'POST'].includes(req.method)) {
            res.sendStatus(400).send({error: 'Wrong METHOD. Expecting PUT,GET,POST'});
            return;
        }

        let body;
        if (req.method === 'GET') {
            body = req.query;
        } else {
            body = req.body;
        }

        res.sendStatus(200);
        this.queue.push({
            eventName: 'generic-webhook.event',
            sender: "GithubWebhooks",
            data: {
                hookData: body,
                hookId: req.params.hookId,
            } as GenericWebhookEvent,
        }).catch((err) => {
            log.error(`Failed to emit payload: ${err}`);
        });
    }

    private onPayload(req: Request, res: Response) {
        log.info(`New webhook: ${req.url}`);
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
            } else if (req.headers['x-atlassian-webhook-identifier']) {
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
        } else if (req.headers['x-atlassian-webhook-identifier']) {
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
