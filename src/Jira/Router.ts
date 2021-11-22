import axios from "axios";
import { Router, Request, Response } from "express";
import qs from "querystring";
import { BridgeConfigJira } from "../Config/Config";
import LogWrapper from "../LogWrapper";
import { MessageQueue } from "../MessageQueue/MessageQueue";
import { OAuthRequest, OAuthTokens } from "../Webhooks";

const log = new LogWrapper("JiraRouter");

export default class JiraRouter {
    constructor(private readonly config: BridgeConfigJira, private readonly queue: MessageQueue) { }

    private async onOAuth(req: Request, res: Response) {
        log.info("Got new JIRA oauth request");
        try {
            const exists = await this.queue.pushWait<OAuthRequest, boolean>({
                eventName: "jira.oauth.response",
                sender: "GithubWebhooks",
                data: {
                    code: req.query.code as string,
                    state: req.query.state as string,
                },
            });
            if (!exists) {
                res.status(404).send(`<p>Could not find user which authorised this request. Has it timed out?</p>`);
                return;
            }
            const accessTokenRes = await axios.post(`https://github.com/login/oauth/access_token?${qs.encode({
                client_id: this.config.oauth.client_id,
                client_secret: this.config.oauth.client_secret,
                code: req.query.code as string,
                redirect_uri: this.config.oauth.redirect_uri,
                state: req.query.state as string,
            })}`);
            // eslint-disable-next-line camelcase
            const result = qs.parse(accessTokenRes.data) as { access_token: string, token_type: string };
            await this.queue.push<OAuthTokens>({
                eventName: "oauth.tokens",
                sender: "GithubWebhooks",
                data: { state: req.query.state as string, ... result },
            });
            res.send(`<p> Your account has been bridged </p>`);
        } catch (ex) {
            log.error("Failed to handle oauth request:", ex);
            res.status(500).send(`<p>Encountered an error handing oauth request</p>`);
        }
    }

    public getRouter() {
        const router = Router();
        router.get("/oauth", this.onOAuth.bind(this));
        return router;
    }
}
