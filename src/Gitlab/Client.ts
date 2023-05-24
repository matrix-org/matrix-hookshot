import axios from "axios";
import { GitLabInstance } from "../config/Config";
import { GetIssueResponse, GetUserResponse, CreateIssueOpts, CreateIssueResponse, GetIssueOpts, EditIssueOpts, GetTodosResponse, EventsOpts, CreateIssueNoteOpts, CreateIssueNoteResponse, GetProjectResponse, ProjectHook, ProjectHookOpts, AccessLevel, SimpleProject } from "./Types";
import { Logger } from "matrix-appservice-bridge";
import { URLSearchParams } from "url";
import UserAgent from "../UserAgent";

const log = new Logger("GitLabClient");

/**
 * A GitLab project used inside a URL may either be the ID of the project, or the encoded path of the project.
 */
type ProjectId = string|number;
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

    async get(path: string) {
        return await axios.get(path, { ...this.defaultConfig, responseType: 'arraybuffer'});
    }

    async version() {
        return (await axios.get("api/v4/versions", this.defaultConfig)).data;
    }

    async user(): Promise<GetUserResponse> {
        return (await axios.get("api/v4/user", this.defaultConfig)).data;
    }

    private async createIssue(opts: CreateIssueOpts): Promise<CreateIssueResponse> {
        return (await axios.post(`api/v4/projects/${encodeURIComponent(opts.id)}/issues`, opts, this.defaultConfig)).data;
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
        return (await axios.put(`api/v4/projects/${encodeURIComponent(opts.id)}/issues/${opts.issue_iid}`, opts, this.defaultConfig)).data;
    }


    private async getProject(id: ProjectId): Promise<GetProjectResponse> {
        try {
            return (await axios.get(`api/v4/projects/${encodeURIComponent(id)}`, this.defaultConfig)).data;
        } catch (ex) {
            log.warn(`Failed to get project:`, ex);
            throw ex;
        }
    }

    private async listProjects(minAccess: AccessLevel, inGroup?: ProjectId, idAfter?: number, search?: string): Promise<SimpleProject[]> {
        try {
            const path = inGroup ? `api/v4/groups/${encodeURIComponent(inGroup)}/projects` : 'api/v4/projects';
            return (await axios.get(path, {
                ...this.defaultConfig,
                params: {
                    archived: false,
                    min_access_level: minAccess,
                    simple: true,
                    pagination: "keyset",
                    per_page: 10,
                    order_by: "id",
                    sort: "asc",
                    id_after: idAfter,
                    search,
                }
                })).data;
        } catch (ex) {
            log.warn(`Failed to get projects:`, ex);
            throw ex;
        }
    }

    private async getProjectHooks(id: ProjectId): Promise<ProjectHook[]> {
        try {
            return (await axios.get(`api/v4/projects/${encodeURIComponent(id)}/hooks`, this.defaultConfig)).data;
        } catch (ex) {
            log.warn(`Failed to get project hooks:`, ex);
            throw ex;
        }
    }

    private async addProjectHook(id: ProjectId, opts: ProjectHookOpts): Promise<ProjectHook> {
        try {
            return (await axios.post(`api/v4/projects/${encodeURIComponent(id)}/hooks`, opts, this.defaultConfig)).data;
        } catch (ex) {
            log.warn(`Failed to create project hook:`, ex);
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

    /**
     * Get the access level the authenticated user has for a project. Includes
     * any access levels inherited from parent project(s).
     * @param id The project ID
     * @returns The user's access level.
     */
    public async getProjectAccessLevel(id: ProjectId): Promise<AccessLevel> {
        try {
            const me = await this.user();
            // https://docs.gitlab.com/ee/api/members.html#get-a-member-of-a-group-or-project-including-inherited-and-invited-members
            const { data } = await axios.get(`api/v4/projects/${encodeURIComponent(id)}/members/all/${me.id}`, this.defaultConfig);
            if (typeof data?.access_level !== "number") {
                throw Error(`Unexpected value for data.access_level. '${data?.access_level}'`);
            } 
            return data.access_level as AccessLevel;
        } catch (ex) {
            if (axios.isAxiosError(ex)) {
                if (ex.response?.status === 404) {
                    return AccessLevel.NoAccess;
                }
            }
            log.warn(`Failed to get project access level:`, ex);
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
            list: this.listProjects.bind(this),
            getMyAccessLevel: this.getProjectAccessLevel.bind(this),
            hooks: {
                list: this.getProjectHooks.bind(this),
                add: this.addProjectHook.bind(this),
            }
        }
    }

    get notes() {
        return {
            createForIssue: this.createIssueNote.bind(this),
        }
    }
}
