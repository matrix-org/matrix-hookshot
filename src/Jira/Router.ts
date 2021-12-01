import { BridgeConfigJira } from "../Config/Config";
import { generateJiraURL } from "./AdminCommands";
import { JiraOAuthResult, JiraProject } from "./Types";
import { MessageQueue } from "../MessageQueue";
import { OAuthRequest } from "../WebhookTypes";
import { Router, Request, Response, NextFunction } from "express";
import { UserTokenStore } from "../UserTokenStore";
import axios from "axios";
import LogWrapper from "../LogWrapper";
import { ApiError, ErrCode } from "../provisioning/api";
import { HookshotJiraApi } from "./Client";

const log = new LogWrapper("JiraRouter");

interface OAuthQuery {
    state: string;
    code: string;
}

export class JiraWebhooksRouter {
    constructor(private readonly config: BridgeConfigJira, private readonly queue: MessageQueue) { }

    private async onOAuth(req: Request<unknown, unknown, unknown, OAuthQuery>, res: Response<string|{error: string}>) {
        if (typeof req.query.state !== "string") {
            return res.status(400).send({error: "Missing 'state' parameter"});
        }
        if (typeof req.query.code !== "string") {
            return res.status(400).send({error: "Missing 'state' parameter"});
        }
        const state = req.query.state as string;
        const code = req.query.code as string;
        log.info(`Got new JIRA oauth request (${state.substring(0, 8)})`);
        try {
            const exists = await this.queue.pushWait<OAuthRequest, boolean>({
                eventName: "jira.oauth.response",
                sender: "GithubWebhooks",
                data: {
                    state,
                },
            });
            if (!exists) {
                return res.status(404).send(`<p>Could not find user which authorised this request. Has it timed out?</p>`);
            }
            const accessTokenRes = await axios.post("https://auth.atlassian.com/oauth/token", {
                client_id: this.config.oauth.client_id,
                client_secret: this.config.oauth.client_secret,
                code: code,
                grant_type: "authorization_code",
                redirect_uri: this.config.oauth.redirect_uri,
            });
            const result = accessTokenRes.data as { access_token: string, scope: string, expires_in: number, refresh_token: string};
            result.expires_in = Date.now() + (result.expires_in * 1000);
            log.debug("JIRA token response:", result);
            await this.queue.push<JiraOAuthResult>({
                eventName: "jira.oauth.tokens",
                sender: "GithubWebhooks",
                data: { state, ... result },
            });
            return res.send(`<p> Your account has been bridged </p>`);
        } catch (ex) {
            log.error("Failed to handle oauth request:", ex);
            return res.status(500).send(`<p>Encountered an error handing oauth request</p>`);
        }
    }

    public getRouter() {
        const router = Router();
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

    private onOAuth(req: Request<undefined, undefined, undefined, {userId: string}>, res: Response<{url: string}>) {
        res.send({
            url: generateJiraURL(this.config.oauth.client_id, this.config.oauth.redirect_uri, this.tokenStore.createStateForOAuth(req.query.userId))
        });
    }

    private async onGetAccount(req: Request<undefined, undefined, undefined, {userId: string}>, res: Response<JiraAccountStatus>, next: NextFunction) {
        const jiraUser = await this.tokenStore.getJiraForUser(req.query.userId);
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
            return next( new ApiError("Could not fetch accessible resources for JIRA user", ErrCode.Unknown));
        }
        return res.send({
            loggedIn: true,
            instances: instances
        })
    }

    private async onGetInstanceProjects(req: Request<{instanceName: string}, undefined, undefined, {userId: string}>, res: Response<JiraProjectsListing[]>, next: NextFunction) {
        const jiraUser = await this.tokenStore.getJiraForUser(req.query.userId);
        if (!jiraUser) {
            // TODO: Better error?
            return next( new ApiError("Not logged in", ErrCode.ForbiddenUser));
        }
    
        let resClient: HookshotJiraApi|null;
        try {
            resClient = await jiraUser.getClientForName(req.params.instanceName);
        } catch (ex) {
            log.warn(`Failed to fetch client for ${req.params.instanceName} for ${req.query.userId}`, ex);
            return next( new ApiError("Could not fetch accessible resources for JIRA user", ErrCode.Unknown));
        }
        if (!resClient) {
            return next( new ApiError("Instance not known or not accessible to this user", ErrCode.ForbiddenUser));
        }
    
        const projects = [];
        try {
            for await (const project of resClient.getAllProjects()) {
                projects.push({
                    key: project.key,
                    name: project.name,
                    // Technically not the real URL, but good enough for hookshot!
                    url: `${resClient.resource.url}/projects/${project.key}`,
                });
            }
        } catch (ex) {
            log.warn(`Failed to fetch accessible projects for ${req.params.instanceName} / ${req.query.userId}`, ex);
            return next( new ApiError("Could not fetch accessible projects for JIRA user", ErrCode.Unknown));
        }
        
        return res.send(projects);
    }
}
