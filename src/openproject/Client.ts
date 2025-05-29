import axios, { Method } from "axios";
import {
  OpenProjectIterableResult,
  OpenProjectMembership,
  OpenProjectPriority,
  OpenProjectProject,
  OpenProjectStatus,
  OpenProjectStoredToken,
  OpenProjectType,
  OpenProjectUser,
  OpenProjectWorkPackage,
} from "./Types";
import { Logger } from "matrix-appservice-bridge";
import { OpenProjectOAuth } from "./Oauth";
const urlJoin = import("url-join").then((d) => d.default);

const log = new Logger("OpenProjectAPIClient");

type OpenProjectProjectWithUrl = OpenProjectProject & { project_url: string };

export class OpenProjectAPIClient {
  private storedToken: OpenProjectStoredToken;
  constructor(
    private readonly baseUrl: URL,
    tokenInfo: string,
    private readonly oauth: OpenProjectOAuth,
    private readonly onTokenRefreshed: (token: OpenProjectStoredToken) => void,
  ) {
    this.storedToken = JSON.parse(tokenInfo);
  }

  private async apiRequest<T, R = unknown>(
    path: string,
    method: Method = "GET",
    data?: R,
  ): Promise<T> {
    await this.checkTokenAge();

    const url = (await urlJoin)(this.baseUrl.toString(), path);
    const res = await axios.request<T>({
      url,
      method: method,
      data,
      headers: {
        Authorization: `Bearer ${this.storedToken.access_token}`,
      },
      responseType: "json",
    });
    return res.data;
  }

  private async checkTokenAge() {
    if (!this.storedToken.refresh_token || !this.storedToken.expires_in) {
      throw Error("Cannot refresh token, token does not support it");
    }
    if (this.storedToken.expires_in > Date.now()) {
      return;
    }
    log.info(`Refreshing oauth token`, Date.now(), this.storedToken.expires_in);
    const data = await this.oauth.exchangeRefreshToken(
      this.storedToken.refresh_token,
    );
    this.storedToken = {
      expires_in: Date.now() + data.expires_in * 1000,
      refresh_token: data.refresh_token,
      access_token: data.access_token,
    };
    this.onTokenRefreshed(this.storedToken);
  }

  async getIdentity(userId = "me"): Promise<OpenProjectUser> {
    return this.apiRequest<OpenProjectUser>(
      `/api/v3/users/${encodeURIComponent(userId)}`,
    );
  }

  async searchProjects(
    nameAndIdentifier?: string,
  ): Promise<OpenProjectProjectWithUrl[]> {
    // See https://www.openproject.org/docs/api/endpoints/projects/
    let projects: OpenProjectProject[];
    if (nameAndIdentifier) {
      const query = [
        { name_and_identifier: { operator: "~", values: [nameAndIdentifier] } },
      ];
      projects = (
        await this.apiRequest<OpenProjectIterableResult<OpenProjectProject>>(
          `/api/v3/projects?filters=${encodeURIComponent(JSON.stringify(query))}`,
        )
      )._embedded.elements;
    } else {
      projects = (
        await this.apiRequest<OpenProjectIterableResult<OpenProjectProject>>(
          `/api/v3/projects`,
        )
      )._embedded.elements;
    }
    // Note: We take the first page of results here for now.
    return projects.map((p) => ({
      ...p,
      project_url: `${this.baseUrl}projects/${p.id}`,
    }));
  }

  async getProject(projectId: number): Promise<OpenProjectProject> {
    return this.apiRequest<OpenProjectProject>(
      `/api/v3/projects/${encodeURIComponent(projectId)}`,
    );
  }

  async getTypesInProject(projectId: number): Promise<OpenProjectType[]> {
    // TODO: Paginate?
    return (
      await this.apiRequest<OpenProjectIterableResult<OpenProjectType>>(
        `/api/v3/projects/${encodeURIComponent(projectId)}/types`,
      )
    )._embedded.elements;
  }

  async searchForUserInProject(
    projectId: number,
    title: string,
  ): Promise<{ href: string; title: string } | undefined> {
    const project = await this.getProject(projectId);
    const memberships = await this.apiRequest<
      OpenProjectIterableResult<OpenProjectMembership>
    >(project._links.memberships.href);
    const lowercaseTitle = title.trim().toLowerCase();
    for (const membership of memberships._embedded.elements) {
      if (membership._links.principal.title.toLowerCase() === lowercaseTitle) {
        return membership._links.principal;
      }
    }
    return undefined;
  }

  async getStatuses(): Promise<OpenProjectStatus[]> {
    // TODO: Paginate?
    return (
      await this.apiRequest<OpenProjectIterableResult<OpenProjectStatus>>(
        `/api/v3/statuses`,
      )
    )._embedded.elements;
  }

  async getPriorities(): Promise<OpenProjectPriority[]> {
    // TODO: Paginate?
    return (
      await this.apiRequest<OpenProjectIterableResult<OpenProjectPriority>>(
        `/api/v3/priorities`,
      )
    )._embedded.elements;
  }

  async createWorkPackage(
    projectId: number,
    type: OpenProjectType,
    subject: string,
    description?: string,
  ): Promise<OpenProjectWorkPackage> {
    const wp: Partial<OpenProjectWorkPackage> = {
      subject,
      _links: {
        type: type._links.self,
      } as any,
    };
    if (description) {
      wp.description = { raw: description, format: "markdown" };
    }
    return this.apiRequest<OpenProjectWorkPackage>(
      `/api/v3/projects/${encodeURIComponent(projectId)}/work_packages`,
      "POST",
      wp,
    );
  }

  async updateWorkPackage(
    workPackageId: number,
    // TODO: Type.
    update: object,
  ): Promise<OpenProjectWorkPackage> {
    // Needed for the lockVersion.
    const existingWp = await this.apiRequest<OpenProjectWorkPackage>(
      `/api/v3/work_packages/${workPackageId}`,
      "GET",
    );
    return this.apiRequest<OpenProjectWorkPackage>(
      `/api/v3/work_packages/${workPackageId}`,
      "PATCH",
      {
        lockVersion: (await existingWp).lockVersion,
        ...update,
      },
    );
  }

  async addWorkPackageComment(wpId: number, comment: string): Promise<void> {
    await this.apiRequest<OpenProjectWorkPackage>(
      `/api/v3/work_packages/${encodeURIComponent(wpId)}/activities`,
      "POST",
      {
        comment: {
          raw: comment,
        },
      },
    );
  }
}
