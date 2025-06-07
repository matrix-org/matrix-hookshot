import { Request, Response, Router, json } from "express";
import { MessageQueue } from "../messageQueue";
import { ApiError, ErrCode } from "../api";
import { Logger } from "matrix-appservice-bridge";
import { BridgeConfigGitLab } from "../config/Config";
import {
  IGitLabWebhookEvent,
  IGitLabWebhookIssueStateEvent,
  IGitLabWebhookMREvent,
  IGitLabWebhookPipelineEvent,
  IGitLabWebhookReleaseEvent,
} from "./WebhookTypes";

const log = new Logger("GitLabWebhooksRouter");
export interface OAuthPageParams {
  service?: string;
  result?: string;
  "oauth-kind"?: "account" | "organisation";
  error?: string;
  errcode?: ErrCode;
}

export class GitLabWebhooksRouter {
  public static IsRequest(req: Request): boolean {
    return !!req.headers["x-gitlab-token"];
  }

  constructor(
    private readonly config: BridgeConfigGitLab,
    private readonly queue: MessageQueue,
  ) {}

  private payloadHandler(body: IGitLabWebhookEvent) {
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
    
    } else if (body.object_kind === "pipeline") {
      const pipeline_event = (body as unknown as IGitLabWebhookPipelineEvent)
      const status = pipeline_event.object_attributes?.status?.toLowerCase();
      if (status === "success") {
        return "gitlab.pipeline.success";
      }
      return "gitlab.pipeline";
    }else {
      return null;
    }
  }

  public verifyRequest(req: Request): void {
    if (typeof req.headers["x-gitlab-token"] !== "string") {
      throw new ApiError(
        "Could not handle GitHub request. Unexpected multiple headers for x-hub-signature-256",
        ErrCode.BadValue,
      );
    }
    if (req.headers["x-gitlab-token"] !== this.config.webhook.secret) {
      throw new ApiError(
        "Could not handle GitLab request. Token did not match.",
        ErrCode.BadValue,
      );
    }
  }

  public onWebhook(req: Request, res: Response) {
    res.send("OK");
    const eventName = this.payloadHandler(req.body);
    if (eventName) {
      this.queue
        .push({
          eventName,
          sender: "GithubWebhooks",
          data: req.body,
        })
        .catch((err) => {
          log.error(`Failed to emit payload: ${err}`);
        });
    }
  }

  public getRouter() {
    const router = Router();
    router.use(json({ verify: this.verifyRequest.bind(this) }));
    router.post("/webhook", this.onWebhook.bind(this));
    return router;
  }
}
