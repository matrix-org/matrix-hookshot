import { createAppAuth } from "@octokit/auth-app";
import { createTokenAuth } from "@octokit/auth-token";
import { Octokit } from "@octokit/rest";
import { promises as fs } from "fs";
import { BridgeConfigGitHub } from "../Config";
import LogWrapper from "../LogWrapper";

const log = new LogWrapper("GithubInstance");

const USER_AGENT = "matrix-github v0.0.1";

export class GithubInstance {
    private internalOctokit!: Octokit;

    public get octokit() {
        return this.internalOctokit;
    }

    constructor (private config: BridgeConfigGitHub) {

    }

    public static createUserOctokit(token: string) {
        return new Octokit({
            authStrategy: createTokenAuth,
            auth: token,
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