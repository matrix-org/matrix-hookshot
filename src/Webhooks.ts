import { BridgeConfig } from "./config/Config";
import { Router, default as express, Request, Response } from "express";
import { EventEmitter } from "events";
import { MessageQueue, createMessageQueue } from "./messageQueue";
import { Logger } from "matrix-appservice-bridge";
import {
  IGitLabWebhookEvent,
  IGitLabWebhookIssueStateEvent,
  IGitLabWebhookMREvent,
  IGitLabWebhookReleaseEvent,
} from "./gitlab/WebhookTypes";
import { IJiraWebhookEvent } from "./jira/WebhookTypes";
import { JiraWebhooksRouter } from "./jira/Router";
import Metrics from "./Metrics";
import { FigmaWebhooksRouter } from "./figma/Router";
import { GenericWebhooksRouter } from "./generic/Router";
import { ApiError, ErrCode } from "./api";
import { OpenProjectWebhooksRouter } from "./openproject/Router";
import { GitHubWebhooksRouter } from "./github/Router";

const log = new Logger("Webhooks");

export interface NotificationsEnableEvent {
  userId: string;
  roomId: string;
  since?: number;
  token: string;
  filterParticipating: boolean;
  type: "github" | "gitlab";
  instanceUrl?: string;
}

export interface NotificationsDisableEvent {
  userId: string;
  type: "github" | "gitlab";
  instanceUrl?: string;
}

export class Webhooks extends EventEmitter {
  public readonly expressRouter = Router();
  private readonly queue: MessageQueue;
  private readonly jira?: JiraWebhooksRouter;
  private readonly github?: GitHubWebhooksRouter;
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
    if (this.queue.stop) {
      this.queue.stop();
    }
  }

  private onGitLabPayload(body: IGitLabWebhookEvent) {
    if (body.object_kind === "merge_request") {
      const action = (body as unknown as IGitLabWebhookMREvent)
        .object_attributes.action;
      if (!action) {
        log.warn(
          "Got gitlab.merge_request but no action field, which usually means someone pressed the test webhooks button.",
        );
        return null;
      }
      return `gitlab.merge_request.${action}`;
    } else if (body.object_kind === "issue") {
      const action = (body as unknown as IGitLabWebhookIssueStateEvent)
        .object_attributes.action;
      if (!action) {
        log.warn(
          "Got gitlab.issue but no action field, which usually means someone pressed the test webhooks button.",
        );
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
        log.warn(
          "Got gitlab.release but no action field, which usually means someone pressed the test webhooks button.",
        );
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

  private onPayload(req: Request, res: Response) {
    try {
      let eventName: string | null = null;
      const body = req.body;
      if (GitHubWebhooksRouter.IsRequest(req)) {
        if (!this.github) {
          log.warn(
            `Not configured for GitHub webhooks, but got a GitHub event`,
          );
          res.sendStatus(500);
          return;
        }
        this.github.onWebhook(req, res);
        return;
      } else if (req.headers["x-gitlab-token"]) {
        res.sendStatus(200);
        eventName = this.onGitLabPayload(body);
      } else if (JiraWebhooksRouter.IsJIRARequest(req)) {
        res.sendStatus(200);
        eventName = this.onJiraPayload(body);
      }
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
      } else {
        log.debug("Unknown event:", req.body);
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
      if (req.headers["x-gitlab-token"] !== this.config.gitlab.webhook.secret) {
        throw new ApiError(
          "Could not handle GitLab request. Token did not match.",
          ErrCode.BadValue,
        );
      }
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
