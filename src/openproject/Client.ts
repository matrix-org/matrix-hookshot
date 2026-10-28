import axios, { Method } from "axios";
import { z } from "zod";
import {
  OpenProjectAvailableAssigneeCollectionSchema,
  OpenProjectIdentitySchema,
  OpenProjectWorkPackageEligibilitySchema,
  OpenProjectWorkPackageFormSchema,
} from "./Types";
import type {
  OpenProjectAvailableAssignee,
  OpenProjectIdentity,
  OpenProjectIterableResult,
  OpenProjectMembership,
  OpenProjectPriority,
  OpenProjectProject,
  OpenProjectStatus,
  OpenProjectStoredToken,
  OpenProjectType,
  OpenProjectWorkPackageForm,
  OpenProjectWorkPackageFormPayload,
  OpenProjectWorkPackageUpdate,
  OpenProjectWorkPackage,
} from "./Types";
import { Logger } from "matrix-appservice-bridge";
import { OpenProjectOAuth } from "./Oauth";
const urlJoin = import("url-join").then((d) => d.default);

const log = new Logger("OpenProjectAPIClient");

type OpenProjectProjectWithUrl = OpenProjectProject & { project_url: string };

/** A successful API response did not match the expected OpenProject shape. */
export class OpenProjectMalformedResponseError extends Error {}

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

  /** The origin used for authenticated API requests. */
  public getOrigin(): string {
    return this.baseUrl.origin;
  }

  private async apiRequest<T, R = unknown>(
    path: string,
    method: Method = "GET",
    data?: R,
    responseSchema?: z.ZodType,
    malformedResponseMessage = "Invalid OpenProject API response",
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
    if (responseSchema) {
      // Validate at the HTTP boundary and preserve the response's extra API fields.
      if (!responseSchema.safeParse(res.data).success) {
        throw new OpenProjectMalformedResponseError(malformedResponseMessage);
      }
    }
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

  async getIdentity(userId = "me"): Promise<OpenProjectIdentity> {
    const identity = await this.apiRequest<OpenProjectIdentity>(
      `/api/v3/users/${encodeURIComponent(userId)}`,
      "GET",
      undefined,
      OpenProjectIdentitySchema,
      "Invalid OpenProject identity response",
    );
    return identity;
  }

  async searchProjects(
    nameAndIdentifier?: string,
  ): Promise<OpenProjectProjectWithUrl[]> {
    // See https://www.openproject.org/docs/api/endpoints/projects/
    let path = "/api/v3/projects";
    if (nameAndIdentifier) {
      const query = [
        { name_and_identifier: { operator: "~", values: [nameAndIdentifier] } },
      ];
      path += `?filters=${encodeURIComponent(JSON.stringify(query))}`;
    }
    const projects = await this.getCollectionElements<OpenProjectProject>(path);

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

  /** Fetch a work package without changing it. */
  async getWorkPackage(workPackageId: number): Promise<OpenProjectWorkPackage> {
    // Validate fields used for eligibility while preserving the full DTO for callers.
    const responseSchema = OpenProjectWorkPackageEligibilitySchema.refine(
      (workPackage) => workPackage.id === workPackageId,
    );
    return this.apiRequest<OpenProjectWorkPackage>(
      `/api/v3/work_packages/${encodeURIComponent(workPackageId)}`,
      "GET",
      undefined,
      responseSchema,
      "Invalid OpenProject work package response",
    );
  }

  /**
   * Fetch the edit form for a work package, optionally validating proposed changes.
   * An empty payload returns the current writable fields and allowed values.
   */
  async getWorkPackageForm(
    workPackageId: number,
    payload: OpenProjectWorkPackageFormPayload = {},
  ): Promise<OpenProjectWorkPackageForm> {
    const form = await this.apiRequest<
      OpenProjectWorkPackageForm,
      OpenProjectWorkPackageFormPayload
    >(
      `/api/v3/work_packages/${encodeURIComponent(workPackageId)}/form`,
      "POST",
      payload,
      OpenProjectWorkPackageFormSchema,
      "Invalid OpenProject work package form response",
    );
    return form;
  }

  /** Fetch all users that can be assigned to a work package. */
  async getAvailableAssignees(
    workPackageId: number,
  ): Promise<OpenProjectAvailableAssignee[]> {
    const assignees: OpenProjectAvailableAssignee[] = [];
    const path = `/api/v3/work_packages/${encodeURIComponent(workPackageId)}/available_assignees`;

    for await (const assignee of this.iterateCollection<OpenProjectAvailableAssignee>(
      path,
      OpenProjectAvailableAssigneeCollectionSchema,
      "Invalid available assignees collection response",
    )) {
      assignees.push(assignee);
    }

    return assignees;
  }

  private async *iterateCollection<T>(
    initialPath: string,
    responseSchema?: z.ZodType,
    malformedResponseMessage = "Invalid OpenProject collection response",
  ): AsyncGenerator<T> {
    const visitedPages = new Set<string>();
    let pagePath = this.getApiPath(initialPath);

    while (pagePath) {
      if (visitedPages.has(pagePath)) {
        throw new OpenProjectMalformedResponseError(
          "OpenProject returned a cyclic collection page link",
        );
      }
      visitedPages.add(pagePath);

      const page = await this.apiRequest<OpenProjectIterableResult<T>>(
        pagePath,
        "GET",
        undefined,
        responseSchema,
        malformedResponseMessage,
      );
      yield* page._embedded.elements;

      const nextPage =
        page._links?.nextByOffset?.href ?? page._links?.nextByCursor?.href;
      pagePath = nextPage ? this.getApiPath(nextPage) : "";
    }
  }

  private async getCollectionElements<T>(path: string): Promise<T[]> {
    const elements: T[] = [];
    for await (const element of this.iterateCollection<T>(path)) {
      elements.push(element);
    }
    return elements;
  }

  private getApiPath(href: string): string {
    try {
      const url = new URL(href, this.baseUrl);
      if (url.origin !== this.baseUrl.origin) {
        throw new OpenProjectMalformedResponseError(
          "OpenProject returned a link for a different origin",
        );
      }
      return `${url.pathname}${url.search}`;
    } catch (error) {
      if (error instanceof OpenProjectMalformedResponseError) {
        throw error;
      }
      throw new OpenProjectMalformedResponseError(
        "OpenProject returned an invalid collection page link",
      );
    }
  }

  async getTypesInProject(projectId: number): Promise<OpenProjectType[]> {
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
    const lowercaseTitle = title.trim().toLowerCase();
    for await (const membership of this.iterateCollection<OpenProjectMembership>(
      project._links.memberships.href,
    )) {
      if (membership._links.principal.title.toLowerCase() === lowercaseTitle) {
        return membership._links.principal;
      }
    }
    return undefined;
  }

  async getStatuses(): Promise<OpenProjectStatus[]> {
    return (
      await this.apiRequest<OpenProjectIterableResult<OpenProjectStatus>>(
        `/api/v3/statuses`,
      )
    )._embedded.elements;
  }

  async getPriorities(): Promise<OpenProjectPriority[]> {
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
    lockVersion: number,
    update: OpenProjectWorkPackageUpdate,
  ): Promise<OpenProjectWorkPackage> {
    return this.apiRequest<OpenProjectWorkPackage>(
      `/api/v3/work_packages/${workPackageId}`,
      "PATCH",
      {
        ...update,
        lockVersion,
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
