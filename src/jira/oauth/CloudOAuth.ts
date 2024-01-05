import { BridgeConfigJiraCloudOAuth } from "../../config/Config";
import { JiraOAuth } from "../OAuth";
import qs from "querystring";
import axios from "axios";
import { JiraOAuthResult } from "../Types";

const JiraOnPremOAuthScopes = [
    // Reading issues, comments
    "read:jira-work",
    // Creating issues, comments
    "write:jira-work",
    // Reading user
    "read:jira-user",
    "read:me",
    "read:account",
    // To get a refresh token
    "offline_access",
];


export class JiraCloudOAuth implements JiraOAuth {
    constructor(private readonly config: BridgeConfigJiraCloudOAuth) { }
    public async getAuthUrl(state: string) {
        const options = {
            audience: "api.atlassian.com",
            client_id: this.config.client_id,
            scope: JiraOnPremOAuthScopes.join(" "),
            redirect_uri: this.config.redirect_uri,
            state: state,
            response_type: "code",
            prompt: "consent",
        };
        return `https://auth.atlassian.com/authorize?${qs.stringify(options)}`;
    }

    public async exchangeRequestForToken(code: string): Promise<JiraOAuthResult> {
        const accessTokenRes = await axios.post("https://auth.atlassian.com/oauth/token", {
            client_id: this.config.client_id,
            client_secret: this.config.client_secret,
            code: code,
            grant_type: "authorization_code",
            redirect_uri: this.config.redirect_uri,
        });
        const result = accessTokenRes.data as { access_token: string, scope: string, expires_in: number, refresh_token: string};
        result.expires_in = Date.now() + (result.expires_in * 1000);
        return result;
    }
}
