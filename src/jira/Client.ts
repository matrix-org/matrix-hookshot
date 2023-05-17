import axios, { Method } from 'axios';
import JiraApi from 'jira-client';
import { JiraAccount, JiraAPIAccessibleResource, JiraProject } from './Types';

export function isJiraCloudInstance(host: string) {
    return host.endsWith('atlassian.net');
}

export interface JiraClient {
    getAccessibleResources(): Promise<JiraAPIAccessibleResource[]>;
    getClientForUrl(url: URL): Promise<HookshotJiraApi|null>;
    getClientForName(name: string): Promise<HookshotJiraApi|null>;
    getClientForResource(res: JiraAPIAccessibleResource): Promise<HookshotJiraApi|null>;
}

export class JiraApiError extends Error {
    constructor(readonly errorMessages: string[], readonly errors: { description: string}) {
        super();
    }

    public get message() {
        return `JIRA API Error: ${this.errors.description}`;
    }
}


export abstract class HookshotJiraApi extends JiraApi {
    constructor(private options: JiraApi.JiraApiOptions, private readonly res: JiraAPIAccessibleResource) {
        super(options);
    }

    public get resource() {
        return this.res;
    }

    public abstract getAllProjects(query?: string, maxResults?: number): AsyncIterable<JiraProject>;

    protected async apiRequest<T>(path: string, method?: Method, data?: undefined): Promise<T>
    protected async apiRequest<T, R>(path: string, method: Method, data?: R): Promise<T> {
        const url = `https://${this.options.host}/${this.options.base}${path}`;
        const res = await axios.request<T>({ url,
            method: method || "GET",
            data,
            headers: {
                Authorization: `Bearer ${this.options.bearer}`
            },
            responseType: 'json',
        });
        return res.data;
    }
    

    async getProject(projectIdOrKey: string): Promise<JiraProject> {
        return await super.getProject(projectIdOrKey) as JiraProject;
    }

    async searchUsers(opts: {query: string, maxResults?: number}|{username: string, maxResults?: number}): Promise<JiraAccount[]> {
        // Types are wrong here.
        return super.searchUsers(opts as never) as unknown as JiraAccount[];
    }
    
    async addNewIssue(issue: JiraApi.IssueObject): Promise<JiraApi.JsonResponse> {
        const res = await super.addNewIssue(issue);
        if (res.errors) {
            throw new JiraApiError(res.errorMessages, res.errors);
        }
        return res;
    }
}
