import { createAppAuth } from "@octokit/auth-app";
import { createTokenAuth } from "@octokit/auth-token";
import { Octokit } from "@octokit/rest";
import { promises as fs } from "fs";
import { BridgeConfigGitHub } from "../Config/Config";
import LogWrapper from "../LogWrapper";
import { Discussion, DiscussionQL } from "./Discussion";

const log = new LogWrapper("GithubInstance");

const USER_AGENT = "matrix-github v0.0.1";
export class GithubInstance {
    private internalOctokit!: Octokit;

    public get octokit() {
        return this.internalOctokit;
    }

    constructor (private config: BridgeConfigGitHub) { }

    public static createUserOctokit(token: string) {
        return new Octokit({
            // XXX: A recent release of octokit (rest/auth-token?) broke passing in the token
            // as an auth parameter. For now we can just do this.
            authStrategy: () => createTokenAuth(token),
            auth: null,
            userAgent: USER_AGENT,
        });
    }

    public async start() {
        // TODO: Make this generic.
        const auth = {
            appId: parseInt(this.config.auth.id as string, 10),
            privateKey: await fs.readFile(this.config.auth.privateKeyFile, "utf-8"),
            installationId: parseInt(this.config.installationId as string, 10),
        };

        this.internalOctokit = new Octokit({
            authStrategy: createAppAuth,
            auth,
            userAgent: USER_AGENT,
        });

        try {
            await this.octokit.rateLimit.get();
            log.info("Auth check success");
        } catch (ex) {
            log.info("Auth check failed:", ex);
            throw Error("Attempting to verify GitHub authentication configration failed");
        }
    }
}

export class GithubGraphQLClient {
    private static headers: Record<string,string> = {
        'GraphQL-Features': 'discussions_api',
    };
    constructor(private readonly octokit: Octokit) { }

    private async query(request: string, variables: Record<string, string|number>) {
        log.debug(`GraphQL Query: ${request}`);
        return this.octokit.graphql(`${request}`, {
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
}`, {name, owner, number}) as any;
        return result.repository.discussion as Discussion;
    }

    public async createDiscussionComment(number: number) {
        // const result = await this.query(`
        // mutation($name: String!, $owner: String!, $number: Int!) {
        //     createDiscussion(input: {}) {
        //         discussion(number: $number) {
        //             ${DiscussionQL}
        //         }
        //     }
        // }`, {name, owner, number}) as any;
        //         return result.repository.discussion as Discussion;
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