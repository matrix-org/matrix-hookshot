
import axios from 'axios';
import QuickLRU from "@alloc/quick-lru";
import { JiraAPIAccessibleResource, JiraIssue, JiraOAuthResult, JiraProject, JiraCloudProjectSearchResponse, JiraStoredToken } from '../Types';
import { BridgeConfigJira, BridgeConfigJiraCloudOAuth } from '../../config/Config';
import { Logger } from "matrix-appservice-bridge";
import { HookshotJiraApi, JiraClient } from '../Client';
import JiraApi from 'jira-client';
import * as qs from "node:querystring";

const log = new Logger("JiraCloudClient");
const ACCESSIBLE_RESOURCE_CACHE_LIMIT = 100;
const ACCESSIBLE_RESOURCE_CACHE_TTL_MS = 60000;


export class HookshotCloudJiraApi extends HookshotJiraApi {
    async getIssue(issueIdOrKey: string): Promise<JiraIssue> {
        return this.apiRequest<JiraIssue>(`/rest/api/3/issue/${issueIdOrKey}`);
    }

    async addNewIssue(issue: JiraApi.IssueObject): Promise<JiraApi.JsonResponse> {
        // V3 has a more complex format.
        if (issue.fields?.description) {
            issue.fields.description = {
                "type": "doc",
                "version": 1,
                "content": [
                    {
                        "type": "paragraph",
                        "content": [
                            {
                                "text": issue.fields.description,
                                "type": "text"
                            }
                        ]
                    }
                ]
            };
        }
        return super.addNewIssue(issue);
    }

    async * getAllProjects(query?: string, maxResults = 10): AsyncIterable<JiraProject> {
        let response;
        let startAt = 0;
        do {
            const params = qs.stringify({
                startAt,
                maxResults,
                query
            });
            response = await this.apiRequest<JiraCloudProjectSearchResponse>(`/rest/api/3/project/search?${params}`);
            yield* response.values;
            startAt += response.maxResults;
        } while(!response.isLast)
    }
}


export class JiraCloudClient implements JiraClient {

    /**
     * Cache of accessible resources for a user.
     */
    static resourceCache = new QuickLRU<string, Promise<JiraAPIAccessibleResource[]>>({
        maxSize: ACCESSIBLE_RESOURCE_CACHE_LIMIT,
        maxAge: ACCESSIBLE_RESOURCE_CACHE_TTL_MS
    });

    constructor(
        private storedToken: JiraStoredToken,
        private readonly onTokenRefreshed: (newData: JiraStoredToken) => Promise<void>,
        private readonly config: BridgeConfigJira,
        private readonly instanceHost: string) {

    }

    private get bearer() {
        return this.storedToken.access_token;
    }

    async getAccessibleResources() {
        try {
            const existingPromise = JiraCloudClient.resourceCache.get(this.bearer);
            if (existingPromise) {
                return await existingPromise;
            }
        } catch {
            // Existing failed promise, break out and try again.
            JiraCloudClient.resourceCache.delete(this.bearer);
        }
        await this.checkTokenAge();
        const promise = (async () => {
            const res = await axios.get(`https://${this.instanceHost}/oauth/token/accessible-resources`, {
                headers: {
                    Authorization: `Bearer ${this.bearer}`
                },
                responseType: 'json',
            });
            return res.data as JiraAPIAccessibleResource[];
        })();
        JiraCloudClient.resourceCache.set(this.bearer, promise);
        return promise;
    }

    async checkTokenAge() {
        if (!this.storedToken.refresh_token || !this.storedToken.expires_in) {
            throw Error('Cannot refresh token, token does not support it');
        }
        if (this.storedToken.expires_in + 60000 > Date.now()) {
            return;
        }
        log.info(`Refreshing oauth token`);
        if ("client_id" in (this.config.oauth || {}) === false) {
            throw Error('Cannot refresh token, on-prem installs do not support it');
        }
        const config = this.config.oauth as BridgeConfigJiraCloudOAuth;
        // Refresh the token
        const res = await axios.post(`https://${this.instanceHost}/oauth/token`, {
            grant_type: "refresh_token",
            client_id: config.client_id,
            client_secret: config.client_secret,
            refresh_token: this.storedToken.refresh_token,
        });
        const data = res.data as JiraOAuthResult;
        if (data.expires_in) {
            data.expires_in += Date.now() + (data.expires_in * 1000);
        }
        this.storedToken = {
            expires_in: data.expires_in,
            refresh_token: data.refresh_token,
            access_token: data.access_token,
            instance: this.config.instanceName,
        };
        this.onTokenRefreshed(this.storedToken);
    }

    async getClientForUrl(url: URL) {
        const resource = (await this.getAccessibleResources()).find((r) => new URL(r.url).origin === url.origin);
        if (!resource) {
            return null;
        } 
        return this.getClientForResource(resource);
    }

    async getClientForName(name: string) {
        const resource = (await this.getAccessibleResources()).find((r) => r.name === name);
        if (!resource) {
            return null;
        } 
        return this.getClientForResource(resource);
    }

    async getClientForResource(res: JiraAPIAccessibleResource) {
        // Check token age
        await this.checkTokenAge();
        return new HookshotCloudJiraApi({
            protocol: 'https',
            host: this.instanceHost,
            base: `/ex/jira/${res.id}`,
            apiVersion: '3',
            strictSSL: true,
            bearer: this.bearer,
        }, res);
    }
}