import { Request, Response, Router, json } from "express";
import { BridgeOpenProjectConfig } from "../config/sections/OpenProject";
import { MessageQueue } from "../messageQueue";
import { OpenProjectWebhookPayload } from "./Types";
import { ApiError, ErrCode } from "../api";
import { createHmac } from "node:crypto";
import { Logger } from "matrix-appservice-bridge";
import { OAuthRequest, OAuthRequestResult } from "../tokens/Oauth";

const log = new Logger("OpenProjectWebhooksRouter");
export class OpenProjectWebhooksRouter {
  public static IsRequest(req: Request): boolean {
    if (req.headers["x-atlassian-webhook-identifier"]) {
      return true; // Cloud
    } else if (req.headers["user-agent"]?.match(/JIRA/)) {
      return true; // JIRA On-prem
    }
    return false;
  }

  constructor(
    private readonly config: BridgeOpenProjectConfig,
    private readonly queue: MessageQueue,
  ) {}

  /**
   * Verifies a webhook request for a valid signature.
   * @throws If the request is invalid
   * @param req The express request.
   */
  public verifyWebhookRequest(req: Request, _res: never, buffer: Buffer): void {
    const signature = req.headers["x-op-signature"]?.slice("sha1=".length);
    if (!signature) {
      throw new ApiError("No signature provided on request", ErrCode.BadToken);
    }

    const calculatedSecret = createHmac("sha1", this.config.webhook.secret)
      .update(buffer)
      .digest("hex");
    if (signature !== calculatedSecret) {
      throw new ApiError("Signature did not match", ErrCode.BadToken);
    }
    return;
  }

  private onWebhook(
    req: Request<unknown, unknown, OpenProjectWebhookPayload, unknown>,
    res: Response<string | { error: string }>,
  ) {
    const payload = req.body;
    res.status(200).send("OK");
    this.queue.push({
      eventName: `openproject.${payload.action}`,
      data: payload,
      sender: "GithubWebhooks",
    });
  }

  private async onOAuth(
    req: Request<unknown, unknown, unknown, { code: string; state: string }>,
    res: Response<string | { error: string }>,
  ) {
    let result: OAuthRequestResult;
    if (typeof req.query.state !== "string") {
      throw new ApiError("Missing 'state' parameter", ErrCode.BadValue);
    }
    if (typeof req.query.code !== "string") {
      throw new ApiError("Missing 'code' parameter", ErrCode.BadValue);
    }
    const { state, code } = req.query;
    log.info(`Got new OpenProject oauth request (${state.substring(0, 8)})`);
    try {
      result = await this.queue.pushWait<OAuthRequest, OAuthRequestResult>({
        eventName: "openproject.oauth.response",
        sender: "GithubWebhooks",
        data: {
          state,
          code,
        },
      });
    } catch (ex) {
      log.error("Failed to handle oauth request:", ex);
      throw new ApiError(
        "Encountered an error handing oauth request",
        ErrCode.Unknown,
      );
    }

    switch (result) {
      case OAuthRequestResult.Success:
        return res.send(`<p> Your account has been bridged </p>`);
      case OAuthRequestResult.UserNotFound:
        return res
          .status(404)
          .send(
            `<p>Could not find user which authorised this request. Has it timed out?</p>`,
          );
      default:
        return res.status(404).send(`<p>Unknown failure</p>`);
    }
  }

  public getRouter() {
    const router = Router();
    router.use(json({ verify: this.verifyWebhookRequest.bind(this) }));
    router.post("/webhook", this.onWebhook.bind(this));
    router.get("/oauth", this.onOAuth.bind(this));
    return router;
  }
}
