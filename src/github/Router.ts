import { Request, Response, Router, json } from "express";
import { MessageQueue } from "../messageQueue";
import { ApiError, ErrCode } from "../api";
import { Logger } from "matrix-appservice-bridge";
import { OAuthRequest } from "../tokens/Oauth";
import { BridgeConfigGitHub } from "../config/Config";
import {
  EmitterWebhookEvent,
  Webhooks as OctokitWebhooks,
} from "@octokit/webhooks";
import QuickLRU from "@alloc/quick-lru";
import { WebhookEventName } from "@octokit/webhooks-types";
import { GithubInstance } from "./GithubInstance";
import axios from "axios";
import { GitHubOAuthTokenResponse } from "./Types";
import qs from "querystring";

const log = new Logger("GitHubWebhooksRouter");

interface GitHubRequestData {
  payload: string;
  signature: string;
}

interface WebhooksExpressRequest extends Request {
  github?: GitHubRequestData;
}

export interface OAuthPageParams {
  service?: string;
  result?: string;
  "oauth-kind"?: "account" | "organisation";
  error?: string;
  errcode?: ErrCode;
}

export class GitHubWebhooksRouter {
  private readonly ghWebhooks: OctokitWebhooks<unknown>;
  private readonly handledGuids = new QuickLRU<string, void>({
    maxAge: 5000,
    maxSize: 100,
  });
  public static IsRequest(req: Request): boolean {
    if (req.headers["x-github-delivery"]) {
      return true; // Cloud
    }
    return false;
  }

  constructor(
    private readonly config: BridgeConfigGitHub,
    private readonly queue: MessageQueue,
    private readonly widgetsUrl?: URL,
  ) {
    this.ghWebhooks = new OctokitWebhooks({
      secret: config.webhook.secret,
    });
    this.ghWebhooks.onAny((e) => this.payloadHandler(e));
  }

  private async payloadHandler({ id, name, payload }: EmitterWebhookEvent) {
    const action = (payload as unknown as { action: string | undefined })
      .action;
    const eventName = `github.${name}${action ? `.${action}` : ""}`;
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

  public verifyRequest(
    req: WebhooksExpressRequest,
    _res: Response,
    buffer: Buffer,
    encoding: BufferEncoding,
  ): void {
    if (typeof req.headers["x-hub-signature-256"] !== "string") {
      throw new ApiError(
        "Could not handle GitHub request. Unexpected multiple headers for x-hub-signature-256",
        ErrCode.BadValue,
      );
    }
    try {
      const jsonStr = buffer.toString(encoding);
      req.github = {
        payload: jsonStr,
        signature: req.headers["x-hub-signature-256"],
      };
    } catch (ex) {
      log.warn("GitHub signature could not be decoded", ex);
      throw new ApiError(
        "Could not handle GitHub request. Signature could not be decoded",
        ErrCode.BadValue,
      );
    }
  }

  public onWebhook(
    req: WebhooksExpressRequest,
    res: Response<string | { error: string }>,
  ) {
    const githubGuid = req.headers["x-github-delivery"];
    const githubEvent = req.headers["x-github-event"];
    if (githubGuid === undefined) {
      throw new ApiError(
        "GitHub request did not have a x-github-delivery header",
        ErrCode.BadValue,
      );
    }

    if (typeof githubGuid !== "string") {
      throw new ApiError(
        "Header x-github-delivery was invalid",
        ErrCode.BadValue,
      );
    }

    if (githubEvent === undefined) {
      throw new ApiError(
        "GitHub request did not have a x-github-delivery header",
        ErrCode.BadValue,
      );
    }

    if (typeof githubEvent !== "string") {
      throw new ApiError(
        "Header x-github-delivery was invalid",
        ErrCode.BadValue,
      );
    }
    // Send response early.
    res.sendStatus(200);
    if (this.handledGuids.has(githubGuid)) {
      return;
    }
    this.handledGuids.set(githubGuid);
    const githubData = req.github as GitHubRequestData;
    if (!githubData) {
      throw Error("Expected github data to be set on request");
    }
    this.ghWebhooks
      .verifyAndReceive({
        id: githubGuid as string,
        name: githubEvent as WebhookEventName,
        payload: githubData.payload,
        signature: githubData.signature,
      })
      .catch((err) => {
        log.error(`Failed handle GitHubEvent: ${err}`);
      });
  }

  public async onGetOAuth(
    req: Request<
      unknown,
      unknown,
      unknown,
      {
        error?: string;
        error_description?: string;
        code?: string;
        state?: string;
        setup_action?: "install";
      }
    >,
    res: Response,
  ) {
    const oauthResultParams: OAuthPageParams = {
      service: "github",
    };

    const { setup_action: setupAction, state } = req.query;
    log.info("Got new oauth request", { state, setupAction });
    try {
      if (!this.config.oauth) {
        throw new ApiError(
          "Bridge is not configured with OAuth support",
          ErrCode.DisabledFeature,
        );
      }
      if (req.query.error) {
        throw new ApiError(
          `GitHub Error: ${req.query.error} ${req.query.error_description}`,
          ErrCode.Unknown,
        );
      }
      if (setupAction === "install") {
        // GitHub App successful install.
        oauthResultParams["oauth-kind"] = "organisation";
        oauthResultParams.result = "success";
      } else if (setupAction === "request") {
        // GitHub App install is pending
        oauthResultParams["oauth-kind"] = "organisation";
        oauthResultParams.result = "pending";
      } else if (setupAction) {
        // GitHub App install is in another, unknown state.
        oauthResultParams["oauth-kind"] = "organisation";
        oauthResultParams.result = setupAction;
      } else {
        // This is a user account setup flow.
        oauthResultParams["oauth-kind"] = "account";
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
            code: req.query.code,
          },
        });
        if (!exists) {
          throw new ApiError(
            `Could not find user which authorised this request. Has it timed out?`,
            undefined,
            404,
          );
        }
        const accessTokenUrl = GithubInstance.generateOAuthUrl(
          this.config.baseUrl,
          "access_token",
          {
            client_id: this.config.oauth.client_id,
            client_secret: this.config.oauth.client_secret,
            code: req.query.code as string,
            redirect_uri: this.config.oauth.redirect_uri,
            state: req.query.state as string,
          },
        );
        const accessTokenRes = await axios.post(accessTokenUrl);
        const result = qs.parse(accessTokenRes.data) as
          | GitHubOAuthTokenResponse
          | { error: string; error_description: string; error_uri: string };
        if ("error" in result) {
          throw new ApiError(
            `GitHub Error: ${result.error} ${result.error_description}`,
            ErrCode.Unknown,
          );
        }
        oauthResultParams.result = "success";
        await this.queue.push<GitHubOAuthTokenResponse>({
          eventName: "github.oauth.tokens",
          sender: "GithubWebhooks",
          data: { ...result, state: req.query.state as string },
        });
      }
    } catch (ex) {
      if (ex instanceof ApiError) {
        oauthResultParams.result = "error";
        oauthResultParams.error = ex.error;
        oauthResultParams.errcode = ex.errcode;
      } else {
        log.error("Failed to handle oauth request:", ex);
        return res.status(500).send("Failed to handle oauth request");
      }
    }
    const oauthUrl = this.widgetsUrl && new URL("oauth.html", this.widgetsUrl);
    if (oauthUrl) {
      // If we're serving widgets, do something prettier.
      Object.entries(oauthResultParams).forEach(([key, value]) =>
        oauthUrl.searchParams.set(key, value),
      );
      return res.redirect(oauthUrl.toString());
    } else {
      if (oauthResultParams.result === "success") {
        return res.send(
          `<p> Your ${oauthResultParams.service} ${oauthResultParams["oauth-kind"]} has been bridged </p>`,
        );
      } else if (oauthResultParams.result === "error") {
        return res
          .status(500)
          .send(
            `<p> There was an error bridging your ${oauthResultParams.service} ${oauthResultParams["oauth-kind"]}. ${oauthResultParams.error} ${oauthResultParams.errcode} </p>`,
          );
      } else {
        return res
          .status(500)
          .send(
            `<p> Your ${oauthResultParams.service} ${oauthResultParams["oauth-kind"]} is in state ${oauthResultParams.result} </p>`,
          );
      }
    }
  }

  public getRouter() {
    const router = Router();
    router.use(json({ verify: this.verifyRequest.bind(this) }));
    router.get("/", this.onWebhook.bind(this));
    router.get("/oauth", this.onGetOAuth.bind(this));
    return router;
  }
}
