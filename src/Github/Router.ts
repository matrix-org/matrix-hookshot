import { Router, Request, Response } from "express";
import { BridgeConfigGitHub } from "../Config/Config";
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
        res.send({
            url: generateGitHubOAuthUrl(this.config.oauth.client_id, this.config.oauth.redirect_uri, this.tokenStore.createStateForOAuth(req.query.userId))
        });
    }
}
