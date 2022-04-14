import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import LogWrapper from "../LogWrapper";
import { DiscussionQLResponse, DiscussionQL } from "./Discussion";
import * as GitHubWebhookTypes from "@octokit/webhooks-types";
import { GitHubOAuthTokenResponse, InstallationDataType } from "./Types";
import axios from "axios";
import qs from "querystring";
import UserAgent from "../UserAgent";

const log = new LogWrapper("GithubInstance");

interface Installation {
    account: {
        login?: string;
    } | null; 
    id: number;
    repository_selection: "selected"|"all";
    matchesRepository: string[];
}

export class GithubInstance {
    private internalOctokit!: Octokit;
    private readonly installationsCache = new Map<number, Installation>();
    private internalAppSlug?: string;

    constructor (private readonly appId: number|string, private readonly privateKey: string) {
        this.appId = parseInt(appId as string, 10);
    }

    public get appSlug() {
        return this.internalAppSlug;
    }

    public get appOctokit() {
        if (!this.internalOctokit) {
            throw Error('Instance is not ready yet');
        }
        return this.internalOctokit;
    }


    public static createUserOctokit(token: string) {
        return new Octokit({
            auth: token,
            userAgent: UserAgent,
        });
    }

    public static async refreshAccessToken(refreshToken: string, clientId: string, clientSecret: string): Promise<GitHubOAuthTokenResponse> {
        const accessTokenRes = await axios.post(`https://github.com/login/oauth/access_token?${qs.encode({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
        })}`);
        return qs.decode(accessTokenRes.data) as unknown as GitHubOAuthTokenResponse;
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
            userAgent: UserAgent,
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
            userAgent: UserAgent,
        });


        const appDetails = await this.internalOctokit.apps.getAuthenticated();
        this.internalAppSlug = appDetails.data.slug;

        let installPageSize = 100;
        let page = 1;
        do {
            const installations = await this.internalOctokit.apps.listInstallations({ per_page: 100, page: page++ });
            for (const install of installations.data) {
                await this.addInstallation(install);
            }
            installPageSize = installations.data.length;
        } while(installPageSize === 100)

        log.info(`Found ${this.installationsCache.size} installations`);
    }

    private async addInstallation(install: InstallationDataType, repos?: {full_name: string}[]) {
        let matchesRepository: string[] = [];
        if (install.repository_selection === "all") {
            matchesRepository = [`${install.account?.login}/*`.toLowerCase()];
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
        // E.g. https://github.com/apps/matrix-bridge/installations/new
        return `https://github.com/apps/${this.appSlug}/installations/new`;
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
