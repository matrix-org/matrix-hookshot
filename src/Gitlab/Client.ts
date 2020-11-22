import axios from "axios";
import { GetIssueResponse, GetUserResponse, CreateIssueOpts, CreateIssueResponse, GetIssueOpts, EditIssueOpts, GetTodosResponse } from "./Types";
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

    private async getIssue(opts: GetIssueOpts): Promise<GetIssueResponse> {
        const projectBit = opts.projects.join("%2F");
        const url = `${this.instanceUrl}/api/v4/projects/${projectBit}/issues/${opts.issue}`;
        return (await axios.get(url, this.defaultConfig)).data;
    }

    private async editIssue(opts: EditIssueOpts): Promise<CreateIssueResponse> {
        return (await axios.put(`${this.instanceUrl}/api/v4/projects/${opts.id}/issues/${opts.issue_iid}`, opts, this.defaultConfig)).data;
    }

    public async getTodos() {
        return (await axios.get(`${this.instanceUrl}/api/v4/todos`, this.defaultConfig)).data as GetTodosResponse[];
    }

    get issues() {
        return {
            create: this.createIssue.bind(this),
            edit: this.editIssue.bind(this),
            get: this.getIssue.bind(this),
        }
    }
}