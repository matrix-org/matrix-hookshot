import { Router, Request, Response } from "express";
import { BridgeConfigGitHub } from "../Config/Config";
import { ApiError, ErrCode } from "../provisioning/api";
import { UserTokenStore } from "../UserTokenStore";
import { generateGitHubOAuthUrl } from "./AdminCommands";

export class GitHubProvisionerRouter {
    constructor(private readonly config: BridgeConfigGitHub, private readonly tokenStore: UserTokenStore) { }

    public getRouter() {
        const router = Router();
        router.get("/oauth", this.onOAuth.bind(this));
        return router;
    }

    private onOAuth(req: Request<undefined, undefined, undefined, {userId: string}>, res: Response<{url: string}>) {
        if (!this.config.oauth) {
            throw new ApiError("GitHub is not configured to support OAuth", ErrCode.UnsupportedOperation);
        }
        res.send({
            url: generateGitHubOAuthUrl(this.config.oauth.client_id, this.config.oauth.redirect_uri, this.tokenStore.createStateForOAuth(req.query.userId))
        });
    }
}
