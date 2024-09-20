import { BridgeConfigJira } from "../config/Config";
import { MessageQueue } from "../MessageQueue";
import { Router, Request, Response, NextFunction, json } from "express";
import { UserTokenStore } from "../tokens/UserTokenStore";
import { Logger } from "matrix-appservice-bridge";
import { ApiError, ErrCode } from "../api";
import { JiraOAuthRequestCloud, JiraOAuthRequestOnPrem, JiraOAuthRequestResult } from "./OAuth";
import { HookshotJiraApi } from "./Client";

const log = new Logger("JiraRouter");

interface OAuthQueryCloud {
    state: string;
    code: string;
}

interface OAuthQueryOnPrem {
    state: string;
    oauth_token: string;
    oauth_verifier: string;
}

export class JiraWebhooksRouter {

    public static IsJIRARequest(req: Request): boolean {
        if (req.headers['x-atlassian-webhook-identifier']) {
            return true; // Cloud
        } else if (req.headers['user-agent']?.match(/JIRA/)) {
            return true; // JIRA On-prem
        }
        return false;
    }

    constructor(private readonly queue: MessageQueue) {
    }

    private async onOAuth(req: Request<unknown, unknown, unknown, OAuthQueryCloud|OAuthQueryOnPrem>, res: Response<string|{error: string}>) {
        let result: JiraOAuthRequestResult;
        if ("oauth_token" in req.query) {
            // On-prem
            if (typeof req.query.state !== "string") {
                return res.status(400).send({error: "Missing 'state' parameter"});
            }
            if (typeof req.query.oauth_token !== "string") {
                return res.status(400).send({error: "Missing 'code' parameter"});
            }
            const { state, oauth_token, oauth_verifier } = req.query;
            try {
                result = await this.queue.pushWait<JiraOAuthRequestOnPrem, JiraOAuthRequestResult>({
                    eventName: "jira.oauth.response",
                    sender: "GithubWebhooks",
                    data: {
                        state,
                        // eslint-disable-next-line camelcase
                        oauthToken: oauth_token,
                        // eslint-disable-next-line camelcase
                        oauthVerifier: oauth_verifier,
                    },
                });
            }
            catch (ex) {
                log.error("Failed to handle oauth request:", ex);
                return res.status(500).send(`<p>Encountered an error handing oauth request</p>`);
            }
        } else if ("code" in req.query) {
            // Cloud
            if (typeof req.query.state !== "string") {
                return res.status(400).send({error: "Missing 'state' parameter"});
            }
            if (typeof req.query.code !== "string") {
                return res.status(400).send({error: "Missing 'code' parameter"});
            }
            const { state, code } = req.query;
            log.info(`Got new JIRA oauth request (${state.substring(0, 8)})`);
            try {
                result = await this.queue.pushWait<JiraOAuthRequestCloud, JiraOAuthRequestResult>({
                    eventName: "jira.oauth.response",
                    sender: "GithubWebhooks",
                    data: {
                        state,
                        code,
                    },
                });
            } catch (ex) {
                log.error("Failed to handle oauth request:", ex);
                return res.status(500).send(`<p>Encountered an error handing oauth request</p>`);
            }
        } else {
            return res.status(400).send({error: "Missing 'oauth_token'/'code' parameter"});
        }

        switch (result) {
            case JiraOAuthRequestResult.Success:
                return res.send(`<p> Your account has been bridged </p>`);
            case JiraOAuthRequestResult.UserNotFound:
                return res.status(404).send(`<p>Could not find user which authorised this request. Has it timed out?</p>`);
            default:
                return res.status(404).send(`<p>Unknown failure</p>`);
        }
    }

    public getRouter() {
        const router = Router();
        router.use(json());
        router.get("/oauth", this.onOAuth.bind(this));
        return router;
    }
}


interface JiraAccountStatus {
    loggedIn: boolean;
    instances?: {
        name: string;
        url: string;
    }[]
}
interface JiraProjectsListing {
    name: string;
    key: string;
    id: string;
    url: string;
}

export class JiraProvisionerRouter {
    constructor(private readonly config: BridgeConfigJira, private readonly tokenStore: UserTokenStore) { }

    public getRouter() {
        const router = Router();
        router.get("/oauth", this.onOAuth.bind(this));
        router.get("/account", this.onGetAccount.bind(this));
        router.get("/instances/:instanceName/projects", this.onGetInstanceProjects.bind(this));
        return router;
    }

    private async onOAuth(req: Request<undefined, undefined, undefined, {userId: string}>, res: Response<{url: string}>) {
        if (!this.tokenStore.jiraOAuth) {
            throw new ApiError('JIRA OAuth is disabled.', ErrCode.DisabledFeature);
        }
        const url = await this.tokenStore.jiraOAuth.getAuthUrl(this.tokenStore.createStateForOAuth(req.query.userId));
        res.send({ url });
    }

    private async onGetAccount(req: Request<undefined, undefined, undefined, {userId: string}>, res: Response<JiraAccountStatus>, next: NextFunction) {
        const jiraUser = await this.tokenStore.getJiraForUser(req.query.userId, this.config.url);
        if (!jiraUser) {
            return res.send({
                loggedIn: false,
            });
        }
        const instances = [];
        try {
            for (const resource of await jiraUser.getAccessibleResources()) {
                instances.push({
                    url: resource.url,
                    name: resource.name,
                });
            }
        } catch (ex) {
            log.warn(`Failed to fetch accessible resources for ${req.query.userId}`, ex);
            return next( new ApiError("Could not fetch accessible resources for JIRA user.", ErrCode.Unknown));
        }
        return res.send({
            loggedIn: true,
            instances: instances
        })
    }

    private async onGetInstanceProjects(req: Request<{instanceName: string}, undefined, undefined, {userId: string}>, res: Response<JiraProjectsListing[]>, next: NextFunction) {
        const jiraUser = await this.tokenStore.getJiraForUser(req.query.userId, this.config.url);
        if (!jiraUser) {
            // TODO: Better error?
            return next( new ApiError("Not logged in", ErrCode.ForbiddenUser));
        }
    
        let resClient: HookshotJiraApi|null;
        try {
            resClient = await jiraUser.getClientForName(req.params.instanceName);
        } catch (ex) {
            log.warn(`Failed to fetch client for ${req.params.instanceName} for ${req.query.userId}`, ex);
            return next( new ApiError("Could not fetch accessible resources for JIRA user.", ErrCode.Unknown));
        }
        if (!resClient) {
            return next( new ApiError("Instance not known or not accessible to this user.", ErrCode.ForbiddenUser));
        }
    
        const projects: JiraProjectsListing[] = [];
        try {
            for await (const project of resClient.getAllProjects()) {
                projects.push({
                    key: project.key,
                    name: project.name,
                    id: project.id,
                    // Technically not the real URL, but good enough for hookshot!
                    url: `${resClient.resource.url}/projects/${project.key}`,
                });
            }
        } catch (ex) {
            log.warn(`Failed to fetch accessible projects for ${req.params.instanceName} / ${req.query.userId}`, ex);
            return next( new ApiError("Could not fetch accessible projects for JIRA user.", ErrCode.Unknown));
        }
        
        return res.send(projects);
    }
}
