import { Router, Request, Response, NextFunction } from "express";
import { BridgeConfigGitHub } from "../Config/Config";
import { ApiError, ErrCode } from "../api";
import { UserTokenStore } from "../UserTokenStore";
import { generateGitHubOAuthUrl } from "./AdminCommands";
import LogWrapper from "../LogWrapper";
import { GithubInstance } from "./GithubInstance";

const log = new LogWrapper("GitHubProvisionerRouter");
interface GitHubAccountStatus {
    loggedIn: boolean;
    username?: string;
    organisations?: {
        name: string;
        avatarUrl?: string;
    }[]
}
interface GitHubRepoItem {
    name: string;
    owner: string;
    fullName: string;
    description: string|null;
    avatarUrl: string;
}

interface GitHubRepoResponse {
    page: number;
    repositories: GitHubRepoItem[];
    changeSelectionUrl?: string;
}

export class GitHubProvisionerRouter {
    constructor(private readonly config: BridgeConfigGitHub, private readonly tokenStore: UserTokenStore, private readonly githubInstance: GithubInstance) { }

    public getRouter() {
        const router = Router();
        router.get("/oauth", this.onOAuth.bind(this));
        router.get("/account", this.onGetAccount.bind(this));
        router.get("/orgs/:orgName/repositories", this.onGetOrgRepositories.bind(this));
        router.get("/repositories", this.onGetRepositories.bind(this));
        return router;
    }

    private onOAuth(req: Request<undefined, undefined, undefined, {userId: string}>, res: Response<{user_url: string, org_url: string}>) {
        if (!this.config.oauth) {
            throw new ApiError("GitHub is not configured to support OAuth", ErrCode.UnsupportedOperation);
        }
        res.send({
            user_url: generateGitHubOAuthUrl(this.config.oauth.client_id, this.config.oauth.redirect_uri, this.tokenStore.createStateForOAuth(req.query.userId)),
            org_url: this.githubInstance.newInstallationUrl,
        });
    }

    private async onGetAccount(req: Request<undefined, undefined, undefined, {userId: string, page: string, perPage: string}>, res: Response<GitHubAccountStatus>, next: NextFunction) {
        const octokit = await this.tokenStore.getOctokitForUser(req.query.userId);
        if (!octokit) {
            return res.send({
                loggedIn: false,
            });
        }
        const organisations = [];
        const page = req.query.page ? parseInt(req.query.page) : 1;
        const perPage = req.query.perPage ? parseInt(req.query.perPage) : 10;
        try {
            const installs = await octokit.apps.listInstallationsForAuthenticatedUser({page: page, per_page: perPage});
            for (const install of installs.data.installations) {
                if (install.account) {
                    organisations.push({
                        name: install.account.login || "No name", // org or user name
                        avatarUrl: install.account.avatar_url,
                    });
                } else {
                    log.debug(`Skipping install ${install.id}, has no attached account`);
                }
            }
        } catch (ex) {
            log.warn(`Failed to fetch orgs for GitHub user ${req.query.userId}`, ex);
            return next( new ApiError("Could not fetch orgs for GitHub user", ErrCode.AdditionalActionRequired));
        }
        return res.send({
            loggedIn: true,
            username: await (await octokit.users.getAuthenticated()).data.login,
            organisations,
        })
    }

    private async onGetOrgRepositories(req: Request<{orgName: string}, undefined, undefined, {userId: string, page: string, perPage: string}>, res: Response<GitHubRepoResponse>, next: NextFunction) {
        const octokit = await this.tokenStore.getOctokitForUser(req.query.userId);
        if (!octokit) {
            // TODO: Better error?
            return next(new ApiError("Not logged in", ErrCode.ForbiddenUser));
        }

        const ownSelf = await octokit.users.getAuthenticated();

        const repositories = [];
        const page = req.query.page ? parseInt(req.query.page) : 1;
        const perPage = req.query.perPage ? parseInt(req.query.perPage) : 10;
        try {
            let changeInstallUrl: string | undefined = undefined;
            let reposPromise;

            if (ownSelf.data.login === req.params.orgName) {
                const userInstallation = await this.githubInstance.appOctokit.apps.getUserInstallation({username: ownSelf.data.login});
                reposPromise = await octokit.apps.listInstallationReposForAuthenticatedUser({
                    page,
                    installation_id: userInstallation.data.id,
                    per_page: perPage,
                });
                if (userInstallation.data.repository_selection === 'selected') {
                    changeInstallUrl = `https://github.com/settings/installations/${userInstallation.data.id}`;
                }
            } else {
                const orgInstallation = await this.githubInstance.appOctokit.apps.getOrgInstallation({org: req.params.orgName});

                // Github will error if the authed user tries to list repos of a disallowed installation, even
                // if we got the installation ID from the app's instance.
                reposPromise = await octokit.apps.listInstallationReposForAuthenticatedUser({
                    page,
                    installation_id: orgInstallation.data.id,
                    per_page: perPage,
                });
                if (orgInstallation.data.repository_selection === 'selected') {
                    changeInstallUrl = `https://github.com/organizations/${req.params.orgName}/settings/installations/${orgInstallation.data.id}`;
                }
            }
            const reposRes = await reposPromise;
            for (const repo of reposRes.data.repositories) {
                repositories.push({
                    name: repo.name,
                    owner: repo.owner.login,
                    fullName: repo.full_name,
                    description: repo.description,
                    avatarUrl: repo.owner.avatar_url,
                });
            }

            return res.send({
                page,
                repositories,
                changeSelectionUrl: changeInstallUrl,
            });
        } catch (ex) {
            log.warn(`Failed to fetch accessible repos for ${req.params.orgName} / ${req.query.userId}`, ex);
            return next(new ApiError("Could not fetch accessible repos for GitHub org", ErrCode.AdditionalActionRequired));
        }
    }

    private async onGetRepositories(req: Request<undefined, undefined, undefined, {userId: string, page: string, perPage: string}>, res: Response<GitHubRepoResponse>, next: NextFunction) {
        const octokit = await this.tokenStore.getOctokitForUser(req.query.userId);
        if (!octokit) {
            // TODO: Better error?
            return next(new ApiError("Not logged in", ErrCode.ForbiddenUser));
        }

        const repositories = [];
        const page = req.query.page ? parseInt(req.query.page) : 1;
        const perPage = req.query.perPage ? parseInt(req.query.perPage) : 10;
        try {
            const userRes = await octokit.users.getAuthenticated();
            const userInstallation = await this.githubInstance.appOctokit.apps.getUserInstallation({username: userRes.data.login});
            const orgRes = await octokit.apps.listInstallationReposForAuthenticatedUser({
                page,
                installation_id: userInstallation.data.id,
                per_page: perPage,
            });
            for (const repo of orgRes.data.repositories) {
                repositories.push({
                    name: repo.name,
                    owner: repo.owner.login,
                    fullName: repo.full_name,
                    description: repo.description,
                    avatarUrl: repo.owner.avatar_url,
                });
            }

            return res.send({
                page,
                repositories,
                ...(orgRes.data.repository_selection === 'selected' && {changeSelectionUrl: `https://github.com/settings/installations/${userInstallation.data.id}`})
            });
        } catch (ex) {
            log.warn(`Failed to fetch accessible repos for ${req.query.userId}`, ex);
            return next(new ApiError("Could not fetch accessible repos for GitHub user", ErrCode.AdditionalActionRequired));
        }
    }
}
