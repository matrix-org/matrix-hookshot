import { BridgeConfig } from "./config/Config";
import { Router, default as express, Request, Response } from "express";
import { EventEmitter } from "events";
import { MessageQueue, createMessageQueue } from "./messageQueue";
import { Logger } from "matrix-appservice-bridge";
import { IJiraWebhookEvent } from "./jira/WebhookTypes";
import { JiraWebhooksRouter } from "./jira/Router";
import Metrics from "./Metrics";
import { FigmaWebhooksRouter } from "./figma/Router";
import { GenericWebhooksRouter } from "./generic/Router";
import { ApiError, ErrCode } from "./api";
import { OpenProjectWebhooksRouter } from "./openproject/Router";
import { GitHubWebhooksRouter } from "./github/Router";
import { GitLabWebhooksRouter } from "./gitlab/Router";

const log = new Logger("Webhooks");

export class Webhooks extends EventEmitter {
  public readonly expressRouter = Router();
  private readonly queue: MessageQueue;
  private readonly jira?: JiraWebhooksRouter;
  private readonly github?: GitHubWebhooksRouter;
  private readonly gitlab?: GitLabWebhooksRouter;
  constructor(private config: BridgeConfig) {
    super();
    this.expressRouter.use((req, _res, next) => {
      Metrics.webhooksHttpRequest.inc({ path: req.path, method: req.method });
      next();
    });

    this.queue = createMessageQueue(config.queue);

    if (this.config.github) {
      this.github = new GitHubWebhooksRouter(
        this.config.github,
        this.queue,
        this.config.widgets?.parsedPublicUrl,
      );
      this.expressRouter.use("/github", this.github.getRouter());
    }

    if (this.config.gitlab) {
      this.gitlab = new GitLabWebhooksRouter(this.config.gitlab, this.queue);
      this.expressRouter.use("/gitlab", this.gitlab.getRouter());
    }

    if (this.config.jira) {
      this.jira = new JiraWebhooksRouter(
        this.queue,
        this.config.jira.webhook.secret,
      );
      this.expressRouter.use("/jira", this.jira.getRouter());
    }
    if (this.config.figma) {
      this.expressRouter.use(
        "/figma",
        new FigmaWebhooksRouter(this.config.figma, this.queue).getRouter(),
      );
    }
    if (this.config.generic) {
      this.expressRouter.use(
        "/webhook",
        new GenericWebhooksRouter(
          this.queue,
          false,
          this.config.generic.enableHttpGet,
        ).getRouter(),
      );
      // TODO: Remove old deprecated endpoint
      this.expressRouter.use(
        new GenericWebhooksRouter(
          this.queue,
          true,
          this.config.generic.enableHttpGet,
        ).getRouter(),
      );
    }
    if (this.config.openProject) {
      this.expressRouter.use(
        "/openproject",
        new OpenProjectWebhooksRouter(
          this.config.openProject,
          this.queue,
        ).getRouter(),
      );
    }
    this.expressRouter.use(
      express.json({
        verify: this.verifyRequest.bind(this),
        limit: "10mb",
      }),
    );
    this.expressRouter.post("/", this.onPayload.bind(this));
    if (this.github) {
      // Legacy path.
      this.expressRouter.get("/oauth", this.github.onGetOAuth.bind(this));
    }
  }

  public stop() {
    this.queue.stop?.();
  }

  private onJiraPayload(body: IJiraWebhookEvent) {
    body.webhookEvent = body.webhookEvent.replace("jira:", "");
    log.debug(`onJiraPayload ${body.webhookEvent}:`, body);
    return `jira.${body.webhookEvent}`;
  }

  private onPayload(req: Request, res: Response) {
    try {
      const body = req.body;
      if (GitHubWebhooksRouter.IsRequest(req)) {
        if (!this.github) {
          log.warn(
            `Not configured for GitHub webhooks, but got a GitHub event`,
          );
          throw new ApiError("GitHub not configured", ErrCode.DisabledFeature);
        }
        this.github.onWebhook(req, res);
        return;
      } else if (GitLabWebhooksRouter.IsRequest(req)) {
        if (!this.gitlab) {
          log.warn(
            `Not configured for GitLab webhooks, but got a GitLab event`,
          );
          throw new ApiError("GitLab not configured", ErrCode.DisabledFeature);
        }
        this.gitlab.onWebhook(req, res);
        return;
      } else if (JiraWebhooksRouter.IsJIRARequest(req)) {
        let eventName: string | null = null;
        res.sendStatus(200);
        eventName = this.onJiraPayload(body);
        if (eventName) {
          this.queue
            .push({
              eventName,
              sender: "GithubWebhooks",
              data: body,
            })
            .catch((err) => {
              log.error(`Failed to emit payload: ${err}`);
            });
        }
      } else {
        log.debug("Unknown request:", req.body);
        throw new ApiError(
          "Unable to handle webhook payload. Service may not be configured.",
          ErrCode.Unroutable,
        );
      }
    } catch (ex) {
      if (ex instanceof ApiError) {
        throw ex;
      }
      log.error("Failed to emit message", ex);
      throw new ApiError("Unknown error handling webhook.", ErrCode.Unknown);
    }
  }

  private verifyRequest(
    req: Request,
    _res: Response,
    buffer: Buffer,
    encoding: BufferEncoding,
  ): void {
    if (this.config.gitlab && req.headers["x-gitlab-token"]) {
      // XXX: Legacy
      this.gitlab?.verifyRequest(req);
      return;
    } else if (this.github && req.headers["x-hub-signature-256"]) {
      // XXX: Legacy
      this.github.verifyRequest(req, _res, buffer, encoding);
      return;
    } else if (this.jira && JiraWebhooksRouter.IsJIRARequest(req)) {
      this.jira.verifyWebhookRequest(req, buffer);
      return;
    }
  }
}
