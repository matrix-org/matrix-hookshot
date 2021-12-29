import axios from "axios";
import { GitLabInstance } from "../Config/Config";
import { GetIssueResponse, GetUserResponse, CreateIssueOpts, CreateIssueResponse, GetIssueOpts, EditIssueOpts, GetTodosResponse, EventsOpts, CreateIssueNoteOpts, CreateIssueNoteResponse } from "./Types";
import LogWrapper from "../LogWrapper";
import { URLSearchParams } from "url";
import UserAgent from "../UserAgent";

const log = new LogWrapper("GitLabClient");
export class GitLabClient {
    constructor(private instanceUrl: string, private token: string) {

    }

    public static splitUrlIntoParts(instances: {[name: string]: GitLabInstance}, url: string): [string, string[]]|null {
        for (const [instanceKey, instanceConfig] of Object.entries(instances)) {
            if (url.startsWith(instanceConfig.url)) {
                return [instanceKey, url.substr(instanceConfig.url.length).split("/").filter(part => part.length > 0)];
            }
        }
        return null;
    }

    get defaultConfig() {
        return {
            headers: {
                "Authorization": `Bearer ${this.token}`,
                "User-Agent": UserAgent,
            },
            baseURL: this.instanceUrl
        };
    }

    async version() {
        return (await axios.get("api/v4/versions", this.defaultConfig)).data;
    }

    async user(): Promise<GetUserResponse> {
        return (await axios.get("api/v4/user", this.defaultConfig)).data;
    }

    private async createIssue(opts: CreateIssueOpts): Promise<CreateIssueResponse> {
        return (await axios.post(`api/v4/projects/${opts.id}/issues`, opts, this.defaultConfig)).data;
    }

    private async getIssue(opts: GetIssueOpts): Promise<GetIssueResponse> {
        try {
            return (await axios.get(`api/v4/projects/${opts.projects.join("%2F")}/issues/${opts.issue}`, this.defaultConfig)).data;
        } catch (ex) {
            log.warn(`Failed to get issue:`, ex);
            throw ex;
        }
    }

    private async editIssue(opts: EditIssueOpts): Promise<CreateIssueResponse> {
        return (await axios.put(`api/v4/projects/${opts.id}/issues/${opts.issue_iid}`, opts, this.defaultConfig)).data;
    }

    private async getProject(projectParts: string[]): Promise<GetIssueResponse> {
        try {
            return (await axios.get(`api/v4/projects/${projectParts.join("%2F")}`, this.defaultConfig)).data;
        } catch (ex) {
            log.warn(`Failed to get issue:`, ex);
            throw ex;
        }
    }

    public async getEvents(opts: EventsOpts) {
        const after = `${opts.after.getFullYear()}-` +
            `${(opts.after.getMonth()+1).toString().padStart(2, "0")}`+
            `-${opts.after.getDay().toString().padStart(2, "0")}`;
        return (await axios.get(
            `api/v4/events?after=${after}`,
            this.defaultConfig)
        ).data as GetTodosResponse[];
    }

    public async createIssueNote(projectParts: string[], issueId: number, opts: CreateIssueNoteOpts): Promise<CreateIssueNoteResponse> {
        try {
            const qp = new URLSearchParams({
                body: opts.body,
                confidential: (opts.confidential || false).toString(),
            }).toString();
            return (await axios.post(`api/v4/projects/${projectParts.join("%2F")}/issues/${issueId}/notes?${qp}`, undefined, this.defaultConfig)).data as CreateIssueNoteResponse;
        } catch (ex) {
            log.warn(`Failed to create issue note:`, ex);
            throw ex;
        }
    }

    get issues() {
        return {
            create: this.createIssue.bind(this),
            edit: this.editIssue.bind(this),
            get: this.getIssue.bind(this),
        }
    }
    get projects() {
        return {
            get: this.getProject.bind(this),
        }
    }

    get notes() {
        return {
            createForIssue: this.createIssueNote.bind(this),
        }
    }
}
