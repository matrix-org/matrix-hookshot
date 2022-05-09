import { Octokit } from "@octokit/core";
import { PaginateInterface } from "@octokit/plugin-paginate-rest";
import { RestEndpointMethods } from "@octokit/plugin-rest-endpoint-methods/dist-types/generated/method-types";
import { Api } from "@octokit/plugin-rest-endpoint-methods/dist-types/types";
import { GitLabClient } from "../../src/Gitlab/Client";
import { JiraClient } from "../../src/Jira/Client";
import { JiraOAuth } from "../../src/Jira/OAuth";
import { UserTokenStore } from "../../src/UserTokenStore";

export class UserTokenStoreMock {
    public jiraOAuth?: JiraOAuth;

    public load(): Promise<void> {
        throw new Error("Method not implemented.");
    }

    public storeUserToken(): Promise<void> {
        throw new Error("Method not implemented.");
    }

    public clearUserToken(): Promise<boolean> {
        throw new Error("Method not implemented.");
    }

    public storeJiraToken(): Promise<void> {
        throw new Error("Method not implemented.");
    }

    public getUserToken(): Promise<string> {
        throw new Error("Method not implemented.");
    }

    public getGitHubToken(): Promise<string> {
        throw new Error("Method not implemented.");
    }

    public getOctokitForUser(): Promise<Octokit & { paginate: PaginateInterface; } & RestEndpointMethods & Api> {
        throw new Error("Method not implemented.");
    }

    public getGitLabForUser(): Promise<GitLabClient> {
        throw new Error("Method not implemented.");
    }

    public getJiraForUser(): Promise<JiraClient> {
        throw new Error("Method not implemented.");
    }

    public createStateForOAuth(): string {
        throw new Error("Method not implemented.");
    }

    public getUserIdForOAuthState(): string {
        throw new Error("Method not implemented.");
    }

    static create(){
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return new this() as any as UserTokenStore;
    }
}
