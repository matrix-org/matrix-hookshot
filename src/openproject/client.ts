import axios, { Method } from "axios";
import { OpenProjectProject, OpenProjectStoredToken, OpenProjectUser } from "./types";
import { Logger } from "matrix-appservice-bridge";
import { OpenProjectOAuth } from "./oauth";


const log = new Logger('OpenProjectAPIClient');
export class OpenProjectAPIClient {
    private storedToken: OpenProjectStoredToken;
    constructor(private readonly baseUrl: URL, tokenInfo: string, private readonly oauth: OpenProjectOAuth, private readonly onTokenRefreshed: (token: OpenProjectStoredToken) => void) {
        this.storedToken = JSON.parse(tokenInfo);
    }


    private async apiRequest<T, R=unknown>(path: string, method: Method = 'GET', data?: R): Promise<T> {
        await this.checkTokenAge();
        const url = `${this.baseUrl.origin}/${this.baseUrl.pathname}${path}`;
        const res = await axios.request<T>({ url,
            method: method,
            data,
            headers: {
                Authorization: `Bearer ${this.storedToken.access_token}`
            },
            responseType: 'json',
        });
        return res.data;
    }

    private async checkTokenAge() {
        if (!this.storedToken.refresh_token || !this.storedToken.expires_in) {
            throw Error('Cannot refresh token, token does not support it');
        }
        if (this.storedToken.expires_in + 60000 > Date.now()) {
            return;
        }
        log.info(`Refreshing oauth token`);
        const data = await this.oauth.exchangeRefreshToken(this.storedToken.refresh_token);
        this.storedToken = {
            expires_in: data.expires_in,
            refresh_token: data.refresh_token,
            access_token: data.access_token,
        };
        this.onTokenRefreshed(this.storedToken);
    }

    async getIdentity(userId = 'me'): Promise<OpenProjectUser> {
        return this.apiRequest<OpenProjectUser>(`/api/v3/users/${encodeURIComponent(userId)}`);
    }

    async searchProjects(nameAndIdentifier?: string) {
        // See https://www.openproject.org/docs/api/endpoints/projects/
        if (nameAndIdentifier) {
            const query = [
                { "name_and_identifier": { "operator": "~", "values": [nameAndIdentifier] } }
            ]
            return this.apiRequest<{_embedded: { elements: OpenProjectProject[]}}>(
                `/api/v3/projects?filters=${encodeURIComponent(JSON.stringify(query))}`
            );
        }
        return this.apiRequest<{_embedded: { elements: OpenProjectProject[]}}>(`/api/v3/projects`);
    }
    

    // async getProject(projectIdOrKey: string): Promise<JiraProject> {
    //     return await super.getProject(projectIdOrKey) as JiraProject;
    // }

    // async searchUsers(opts: {query: string, maxResults?: number}|{username: string, maxResults?: number}): Promise<JiraAccount[]> {
    //     // Types are wrong here.
    //     return super.searchUsers(opts as never) as unknown as JiraAccount[];
    // }
    
    // async addNewIssue(issue: JiraApi.IssueObject): Promise<JiraApi.JsonResponse> {
    //     const res = await super.addNewIssue(issue);
    //     if (res.errors) {
    //         throw new JiraApiError(res.errorMessages, res.errors);
    //     }
    //     return res;
    // }
}
