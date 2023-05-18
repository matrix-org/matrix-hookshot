
import { JiraAPIAccessibleResource, JiraProject, JiraStoredToken, JiraOnPremProjectSearchResponse } from '../Types';
import { BridgeConfigJiraOnPremOAuth } from '../../config/Config';
import { decodeJiraToken } from '../OAuth';
import { KeyObject } from 'crypto';
import { HookshotJiraApi, JiraClient } from '../Client';
import JiraApi from 'jira-client';

function createSearchTerm(name?: string) {
    return name?.toLowerCase()?.replaceAll(/[^a-z0-9]/g, '') || '';
}

export class HookshotOnPremJiraApi extends HookshotJiraApi {

    constructor(options: JiraApi.JiraApiOptions, res: JiraAPIAccessibleResource) {
        super(options, res);
    }

    async * getAllProjects(search?: string): AsyncIterable<JiraProject> {
        // Note, status is ignored.
        const results = await this.genericGet(`project`) as JiraOnPremProjectSearchResponse;

        // Reasonable search algorithm.
        const searchTerm = search && createSearchTerm(search);
        if (searchTerm) {
            yield *results.filter(p => createSearchTerm(p.name).includes(searchTerm) || createSearchTerm(p.key).includes(searchTerm));
            return;
        }

        yield *results;
    }
}

export class JiraOnPremClient implements JiraClient{
    private readonly token: string;
    private readonly tokenSecret: string;
    private readonly resource: Promise<JiraAPIAccessibleResource>;
    private readonly client: HookshotOnPremJiraApi;
    private readonly instanceUrl: URL;
    constructor(
        storedToken: JiraStoredToken,
        private readonly privateKey: KeyObject,
        private readonly config: BridgeConfigJiraOnPremOAuth,
        instanceUrl: string) {
            const res = decodeJiraToken(storedToken.access_token);
            this.instanceUrl = new URL(instanceUrl);
            this.token = res.oauthToken;
            this.tokenSecret = res.oauthTokenSecret;
            this.client = new HookshotOnPremJiraApi({
                protocol: this.instanceUrl.protocol.replace(':', ''),
                host: this.instanceUrl.hostname,
                port: this.instanceUrl.port,
                apiVersion: '2',
                strictSSL: true,
                oauth: {
                    consumer_key: this.config.consumerKey,
                    // This gets passed through several layers but will be used as
                    // the correct type in https://github.com/request/oauth-sign/blob/master/index.js#L103
                    consumer_secret: this.privateKey as unknown as string,
                    access_token: this.token,
                    access_token_secret: this.tokenSecret,
                }
            }, {id: "on-prem", name: "not-set", url: instanceUrl, scopes: []});
            this.resource = this.client.getServerInfo().then((s) => ({
                id: "on-prem",
                name: s.serverTitle,
                url: instanceUrl,
                scopes: [],
            }));
    }

    async getAccessibleResources(): Promise<JiraAPIAccessibleResource[]> {
        // TODO: This.
        return [await this.resource];
    }

    async getClientForUrl(url: URL) {
        if (this.instanceUrl.host !== url.host) {
            return null;
        } 
        return this.getClientForResource(await this.resource);
    }

    async getClientForName(name: string) {
        const res = await this.resource;
        if (res.name !== name) {
            return null;
        } 
        return this.getClientForResource(res);
    }

    async getClientForResource(res: JiraAPIAccessibleResource) {
        if (res.id !== (await this.resource).id) {
            return null;
        }
        return this.client;
    }
}