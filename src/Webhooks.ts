
/* eslint-disable camelcase */
import { BridgeConfig } from "./config/Config";
import { Router, default as express, Request, Response } from "express";
import { EventEmitter } from "events";
import { MessageQueue, createMessageQueue } from "./MessageQueue";
import { ApiError, ErrCode, Logger } from "matrix-appservice-bridge";
import qs from "querystring";
import axios from "axios";
import { IGitLabWebhookEvent, IGitLabWebhookIssueStateEvent, IGitLabWebhookMREvent, IGitLabWebhookReleaseEvent } from "./Gitlab/WebhookTypes";
import { EmitterWebhookEvent, EmitterWebhookEventName, Webhooks as OctokitWebhooks } from "@octokit/webhooks"
import { IJiraWebhookEvent } from "./jira/WebhookTypes";
import { JiraWebhooksRouter } from "./jira/Router";
import { OAuthRequest } from "./WebhookTypes";
import { GitHubOAuthTokenResponse } from "./github/Types";
import Metrics from "./Metrics";
import { FigmaWebhooksRouter } from "./figma/router";
import { GenericWebhooksRouter } from "./generic/Router";
import { GithubInstance } from "./github/GithubInstance";
import QuickLRU from "@alloc/quick-lru";

const log = new Logger("Webhooks");

export interface NotificationsEnableEvent {
    userId: string;
    roomId: string;
    since?: number;
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

export interface OAuthPageParams {
    service?: string;
    result?: string;
    'oauth-kind'?: 'account'|'organisation';
    'error'?: string;
    'errcode'?: ErrCode;
}

interface GitHubRequestData {
    payload: string;
    signature: string;
}

interface WebhooksExpressRequest extends Request {
    github?: GitHubRequestData;
}

export class Webhooks extends EventEmitter {
    
    public readonly expressRouter = Router();
    private readonly queue: MessageQueue;
    private readonly ghWebhooks?: OctokitWebhooks;
    private readonly handledGuids = new QuickLRU<string, void>({ maxAge: 5000, maxSize: 100 });
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
        this.queue = createMessageQueue(config.queue);
        if (this.config.jira) {
            this.expressRouter.use("/jira", new JiraWebhooksRouter(this.queue).getRouter());
        }
        if (this.config.figma) {
            this.expressRouter.use('/figma', new FigmaWebhooksRouter(this.config.figma, this.queue).getRouter());
        }
        if (this.config.generic) {
            this.expressRouter.use('/webhook', new GenericWebhooksRouter(this.queue, false, this.config.generic.enableHttpGet).getRouter());
            // TODO: Remove old deprecated endpoint
            this.expressRouter.use(new GenericWebhooksRouter(this.queue, true, this.config.generic.enableHttpGet).getRouter());
        }
        this.expressRouter.use(express.json({
            verify: this.verifyRequest.bind(this),
            limit: '10mb', 
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
            if (!action) {
                log.warn("Got gitlab.merge_request but no action field, which usually means someone pressed the test webhooks button.");
                return null;
            }
            return `gitlab.merge_request.${action}`;
        } else if (body.object_kind === "issue") {
            const action = (body as unknown as IGitLabWebhookIssueStateEvent).object_attributes.action;
            if (!action) {
                log.warn("Got gitlab.issue but no action field, which usually means someone pressed the test webhooks button.");
                return null;
            }
            return `gitlab.issue.${action}`;
        } else if (body.object_kind === "note") {
            return `gitlab.note.created`;
        } else if (body.object_kind === "tag_push") {
            return "gitlab.tag_push";
        } else if (body.object_kind === "wiki_page") {
            return "gitlab.wiki_page";
        } else if (body.object_kind === "release") {
            const action = (body as unknown as IGitLabWebhookReleaseEvent).action;
            if (!action) {
                log.warn("Got gitlab.release but no action field, which usually means someone pressed the test webhooks button.");
                return null;
            }
            return `gitlab.release.${action}`;
        } else if (body.object_kind === "push") {
            return `gitlab.push`;
        } else {
            return null;
        }
    }

    private onJiraPayload(body: IJiraWebhookEvent) {
        body.webhookEvent = body.webhookEvent.replace("jira:", "");
        log.debug(`onJiraPayload ${body.webhookEvent}:`, body);
        return `jira.${body.webhookEvent}`;
    }

    private async onGitHubPayload({id, name, payload}: EmitterWebhookEvent) {
        const action = (payload as unknown as {action: string|undefined}).action;
        const eventName =  `github.${name}${action ? `.${action}` : ""}`;
        log.debug(`Got GitHub webhook event ${id} ${eventName}`, payload);
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

    private onPayload(req: WebhooksExpressRequest, res: Response) {
        try {
            let eventName: string|null = null;
            const body = req.body;
            const githubGuid = req.headers['x-github-delivery'] as string|undefined;
            if (githubGuid) {
                if (!this.ghWebhooks) {
                    log.warn(`Not configured for GitHub webhooks, but got a GitHub event`)
                    res.sendStatus(500);
                    return;
                }
                res.sendStatus(200);
                if (this.handledGuids.has(githubGuid)) {
                    return;
                }
                this.handledGuids.set(githubGuid);
                const githubData = req.github as GitHubRequestData;
                if (!githubData) {
                    throw Error('Expected github data to be set on request');
                }
                this.ghWebhooks.verifyAndReceive({
                    id: githubGuid as string,
                    name: req.headers["x-github-event"] as EmitterWebhookEventName,
                    payload: githubData.payload,
                    signature: githubData.signature,
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

    public async onGitHubGetOauth(req: Request<unknown, unknown, unknown, {error?: string, error_description?: string, code?: string, state?: string, setup_action?: 'install'}> , res: Response) {
        const oauthResultParams: OAuthPageParams = {
            service: "github"
        };

        const { setup_action, state } = req.query;
        log.info("Got new oauth request", { state, setup_action });
        try {
            if (!this.config.github || !this.config.github.oauth) {
                throw new ApiError('Bridge is not configured with OAuth support', ErrCode.DisabledFeature);
            }
            if (req.query.error) {
                throw new ApiError(`GitHub Error: ${req.query.error} ${req.query.error_description}`, ErrCode.Unknown);
            }
            if(setup_action === 'install') {
                // GitHub App successful install.
                oauthResultParams["oauth-kind"] = 'organisation';
                oauthResultParams.result = "success";
            } else if (setup_action === 'request') {
                // GitHub App install is pending
                oauthResultParams["oauth-kind"] = 'organisation';
                oauthResultParams.result = "pending";
            } else if (setup_action) {
                // GitHub App install is in another, unknown state.
                oauthResultParams["oauth-kind"] = 'organisation';
                oauthResultParams.result = setup_action;
            }
            else {
                // This is a user account setup flow.
                oauthResultParams['oauth-kind'] = "account";
                if (!state) {
                    throw new ApiError(`Missing state`, ErrCode.BadValue);
                }
                if (!req.query.code) {
                    throw new ApiError(`Missing code`, ErrCode.BadValue);
                }
                const exists = await this.queue.pushWait<OAuthRequest, boolean>({
                    eventName: "github.oauth.response",
                    sender: "GithubWebhooks",
                    data: {
                        state,
                    },
                });
                if (!exists) {
                    throw new ApiError(`Could not find user which authorised this request. Has it timed out?`, undefined, 404);
                }
                const accessTokenUrl = GithubInstance.generateOAuthUrl(this.config.github.baseUrl, "access_token", {
                    client_id: this.config.github.oauth.client_id,
                    client_secret: this.config.github.oauth.client_secret,
                    code: req.query.code as string,
                    redirect_uri: this.config.github.oauth.redirect_uri,
                    state: req.query.state as string,
                });
                const accessTokenRes = await axios.post(accessTokenUrl);
                const result = qs.parse(accessTokenRes.data) as GitHubOAuthTokenResponse|{error: string, error_description: string, error_uri: string};
                if ("error" in result) {
                    throw new ApiError(`GitHub Error: ${result.error} ${result.error_description}`, ErrCode.Unknown);
                }
                oauthResultParams.result = 'success';
                await this.queue.push<GitHubOAuthTokenResponse>({
                    eventName: "github.oauth.tokens",
                    sender: "GithubWebhooks",
                    data: { ...result, state: req.query.state as string },
                });
            }
        } catch (ex) {
            if (ex instanceof ApiError) {
                oauthResultParams.result = 'error';
                oauthResultParams.error = ex.error;
                oauthResultParams.errcode = ex.errcode;
            } else {
                log.error("Failed to handle oauth request:", ex);
                return res.status(500).send('Failed to handle oauth request');
            }
        }
        const oauthUrl = this.config.widgets && new URL("oauth.html", this.config.widgets.parsedPublicUrl);
        if (oauthUrl) {
            // If we're serving widgets, do something prettier.
            Object.entries(oauthResultParams).forEach(([key, value]) => oauthUrl.searchParams.set(key, value));
            return res.redirect(oauthUrl.toString());
        } else {
            if (oauthResultParams.result === 'success') {
                return res.send(`<p> Your ${oauthResultParams.service} ${oauthResultParams["oauth-kind"]} has been bridged </p>`);
            } else if (oauthResultParams.result === 'error') {
                return res.status(500).send(`<p> There was an error bridging your ${oauthResultParams.service} ${oauthResultParams["oauth-kind"]}. ${oauthResultParams.error} ${oauthResultParams.errcode} </p>`);
            } else {
                return res.status(500).send(`<p> Your ${oauthResultParams.service} ${oauthResultParams["oauth-kind"]} is in state ${oauthResultParams.result} </p>`);
            }
        }
    }

    private verifyRequest(req: WebhooksExpressRequest, res: Response, buffer: Buffer, encoding: BufferEncoding) {
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
        } else if (req.headers["x-hub-signature-256"] && this.ghWebhooks) {
            // GitHub
            if (typeof req.headers["x-hub-signature-256"] !== "string") {
                throw new ApiError("Unexpected multiple headers for x-hub-signature-256", ErrCode.BadValue, 400);
            }
            let jsonStr;
            try {
                jsonStr = buffer.toString(encoding)
            } catch (ex) {
                throw new ApiError("Could not decode buffer", ErrCode.BadValue, 400);
            }
            req.github = {
                payload: jsonStr,
                signature: req.headers["x-hub-signature-256"]
            };
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
