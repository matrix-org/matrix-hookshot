import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { Logger } from "matrix-appservice-bridge";
import { DiscussionQLResponse, DiscussionQL } from "./Discussion";
import * as GitHubWebhookTypes from "@octokit/webhooks-types";
import { GitHubOAuthErrorResponse, GitHubOAuthTokenResponse, InstallationDataType, NAMELESS_ORG_PLACEHOLDER } from "./Types";
import axios from "axios";
import UserAgent from "../UserAgent";

const log = new Logger("GithubInstance");

export const GITHUB_CLOUD_URL = new URL("https://api.github.com");
export const GITHUB_CLOUD_PUBLIC_URL = new URL("https://github.com");

export class GitHubOAuthError extends Error {
    constructor(errorResponse: GitHubOAuthErrorResponse) {
        super(`OAuth interaction failed with ${errorResponse.error}: ${errorResponse.error_description}. See ${errorResponse.error_uri}`);
    }
}

export function getNameForGitHubAccount(account: {login: string}|{name?: string}) {
    return ('login' in account) ? account.login : account.name ?? NAMELESS_ORG_PLACEHOLDER;
}

interface Installation {
    account: {
        login?: string;
    } | {
        name: string;
    } | null; 
    id: number;
    repository_selection: "selected"|"all";
    matchesRepository: string[];
}

interface OAuthUrlParameters {
    [key: string]: string|undefined;
    state?: string;
    client_id?: string;
    redirect_uri?: string;
    client_secret?: string,
    refresh_token?: string,
    grant_type?: 'refresh_token',
}

export class GithubInstance {
    private internalOctokit!: Octokit;
    private readonly installationsCache = new Map<number, Installation>();
    private internalAppUrl?: string;

    constructor (private readonly appId: number|string, private readonly privateKey: string, private readonly baseUrl: URL) {
        this.appId = parseInt(appId as string, 10);
    }

    public get appUrl() {
        return this.internalAppUrl;
    }

    public get appOctokit() {
        if (!this.internalOctokit) {
            throw Error('Instance is not ready yet');
        }
        return this.internalOctokit;
    }

    public static baseOctokitConfig(baseUrl: URL) {
        // Enterprise GitHub uses a /api/v3 basepath (https://github.com/octokit/octokit.js#constructor-options)
        // Cloud uses api.github.com
        const url = (baseUrl.hostname === GITHUB_CLOUD_URL.hostname ? baseUrl : new URL("/api/v3", baseUrl)).toString();
        return {
            userAgent: UserAgent,
            // Remove trailing slash, which is always included in URL objects.
            baseUrl: url.endsWith('/') ? url.slice(0, -1) : url,
        }
    }


    public static createUserOctokit(token: string, baseUrl: URL) {
        return new Octokit({
            auth: token,
            ...this.baseOctokitConfig(baseUrl)
        });
    }

    public static async refreshAccessToken(refreshToken: string, clientId: string, clientSecret: string, baseUrl: URL): Promise<GitHubOAuthTokenResponse> {
        const url = GithubInstance.generateOAuthUrl(baseUrl, "access_token", {
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
        });
        const accessTokenRes = await axios.post(url);
        const response: Record<string, unknown> = Object.fromEntries(new URLSearchParams(accessTokenRes.data));
        if ('error' in response) {
            throw new GitHubOAuthError(response as unknown as GitHubOAuthErrorResponse);
        }
        return response as unknown as GitHubOAuthTokenResponse;
    }

    public getSafeOctokitForRepo(orgName: string, repoName?: string) {
        const targetName = (repoName ? `${orgName}/${repoName}` : orgName).toLowerCase();
        for (const install of this.installationsCache.values()) {
            if (install.matchesRepository.includes(targetName) || install.matchesRepository.includes(`${targetName.split('/')[0]}/*`)) {
                return this.createOctokitForInstallation(install.id);
            }
        }
        return null;
    }

    public getOctokitForRepo(orgName: string, repoName?: string) {
        const res = this.getSafeOctokitForRepo(orgName, repoName);
        if (res) {
            return res;
        }
        // TODO: Refresh cache?
        throw Error(`No installation found to handle ${orgName}/${repoName}`);
    }

    private createOctokitForInstallation(installationId: number) {
        return new Octokit({
            authStrategy: createAppAuth,
            auth: {
                appId: this.appId,
                privateKey: this.privateKey,
                installationId,
            },
            ...GithubInstance.baseOctokitConfig(this.baseUrl),
        });
    }

    public async start() {
        // TODO: Make this generic.
        const auth = {
            appId: this.appId,
            privateKey: this.privateKey,
        };


        this.internalOctokit = new Octokit({
            authStrategy: createAppAuth,
            auth,
            ...GithubInstance.baseOctokitConfig(this.baseUrl),
        });

        const appDetails = await this.internalOctokit.apps.getAuthenticated();
        if (!appDetails.data) {
            throw Error("No information returned about GitHub App. Is your GitHub App configured correctly?");
        }
        this.internalAppUrl = appDetails.data.html_url;

        let installPageSize = 100;
        let page = 1;
        do {
            const installations = await this.internalOctokit.apps.listInstallations({ per_page: 100, page: page++ });
            for (const install of installations.data) {
                if (install.suspended_at) {
                    log.warn(`GitHub app install ${install.id} was suspended. GitHub connections using this install may not work correctly`);
                    continue;
                }
                try {
                    await this.addInstallation(install);
                } catch (ex) {
                    log.info(`Failed to handle GitHub installation ${install.id}`, ex);
                }
            }
            installPageSize = installations.data.length;
        } while(installPageSize === 100)

        log.info(`Found ${this.installationsCache.size} installations`);
    }

    private async addInstallation(install: InstallationDataType, repos?: {full_name: string}[]) {
        let matchesRepository: string[] = [];
        if (install.repository_selection === "all" && install.account && 'login' in install.account) {
            matchesRepository = [`${install.account.login}/*`.toLowerCase()];
        } else if (repos) {
            matchesRepository = repos.map(r => r.full_name.toLowerCase());
        } else {
            const installOctokit = this.createOctokitForInstallation(install.id);
            const repos = await installOctokit.apps.listReposAccessibleToInstallation({ per_page: 100 });
            matchesRepository.push(...repos.data.repositories.map(r => r.full_name.toLowerCase()));
        }
        this.installationsCache.set(install.id, {
            account: install.account,
            id: install.id,
            repository_selection: install.repository_selection,
            matchesRepository,
        });
    }

    public onInstallationCreated(data: GitHubWebhookTypes.InstallationCreatedEvent|GitHubWebhookTypes.InstallationUnsuspendEvent) {
        this.addInstallation(data.installation as InstallationDataType, data.repositories);
    }

    public onInstallationRemoved(data: GitHubWebhookTypes.InstallationDeletedEvent|GitHubWebhookTypes.InstallationSuspendEvent) {
        this.installationsCache.delete(data.installation.id);
    }

    public get newInstallationUrl() {
        if (!this.appUrl) {
            throw Error('No configured app url, cannot get installation url');
        }
        return new URL(this.appUrl);
    }

    public static generateOAuthUrl(baseUrl: URL, action: "authorize"|"access_token", params: OAuthUrlParameters) {
        const q = new URLSearchParams(params as Record<string, string>);
        if (baseUrl.hostname === GITHUB_CLOUD_URL.hostname) {
            // Cloud doesn't use `api.` for oauth.
            baseUrl = GITHUB_CLOUD_PUBLIC_URL;
        }
        const rawUrl = baseUrl.toString();
        return rawUrl + `${rawUrl.endsWith('/') ? '' : '/'}` + `login/oauth/${action}?${q}`;
    }
}

export class GithubGraphQLClient {
    private static headers: Record<string,string> = {
        'GraphQL-Features': 'discussions_api',
    };
    constructor(private readonly octokit: Octokit) { }

    private async query(request: string, variables: Record<string, string|number>) {
        log.debug(`GraphQL Query: ${request}`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return this.octokit.graphql<Record<string, any>>(`${request}`, {
            headers: GithubGraphQLClient.headers,
            ...variables,
        });
    }

    public async getDiscussionByNumber(owner: string, name: string, number: number) {
        const result = await this.query(`
query($name: String!, $owner: String!, $number: Int!) {
    repository(name: $name, owner: $owner) {
        discussion(number: $number) {
            ${DiscussionQL}
        }
    }
}`, {name, owner, number});
        return result.repository.discussion as DiscussionQLResponse;
    }

    public async addDiscussionComment(discussionId: string, body: string): Promise<string> {
        const result = await this.query(`
mutation addDiscussionComment($discussionId: ID!, $body: String!) {
    addDiscussionComment(input: {discussionId: $discussionId, body: $body}) {
        comment {
        id
        }
    }
    }`, {discussionId, body});
        return result.addDiscussionComment.comment.id as string;
    }
 
    public async listDiscussions(owner: string, name: string) {
        return this.query(`
query($name: String!, $owner: String!) {
    repository(name: $name, owner: $owner) {
        discussions(first: 10) {
            # type: DiscussionConnection
            totalCount
            nodes {
                # type: Discussion
                id,
                answer {
                    id,
                }
                author{
                    login,
                }
                bodyHTML,
                bodyText,
                category {
                    name,
                    id,
                },
                createdAt,
                locked,
                title,
                url,
            }
        }
    }
}`, {name, owner});
    }
}
