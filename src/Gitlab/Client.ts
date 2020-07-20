import axios from "axios";

export class GitLabClient {
    constructor(private instanceUrl: string, private token: string) {

    }

    get defaultConfig() {
        return {
            headers: {
                Authorization: `Bearer ${this.token}`,
                UserAgent: "matrix-github v0.0.1",
            },
            baseURL: this.instanceUrl
        };
    }

    async version() {
        return (await axios.get(`${this.instanceUrl}/api/v4/versions`, this.defaultConfig)).data;
    }

    async user(): Promise<GetUserResponse> {
        return (await axios.get(`${this.instanceUrl}/api/v4/user`, this.defaultConfig)).data;
    }

    private async createIssue(opts: CreateIssueOpts): Promise<CreateIssueResponse> {
        return (await axios.post(`${this.instanceUrl}/api/v4/projects/${opts.id}/issues`, opts, this.defaultConfig)).data;
    }

    private async editIssue(opts: EditIssueOpts): Promise<CreateIssueResponse> {
        return (await axios.put(`${this.instanceUrl}/api/v4/projects/${opts.id}/issues/${opts.issue_iid}`, opts, this.defaultConfig)).data;
    }

    get issues() {
        return {
            create: this.createIssue.bind(this),
            edit: this.editIssue.bind(this),
        }
    }
}