import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { promises as fs } from "fs";
import { BridgeConfigGitHub } from "../Config";
import LogWrapper from "../LogWrapper";

const log = new LogWrapper("GithubInstance");

export class GithubInstance {
    private internalOctokit!: Octokit;

    public get octokit() {
        return this.internalOctokit;
    }

    constructor (private config: BridgeConfigGitHub) {

    }

    public async start() {
        // TODO: Make this generic.
        const auth = {
            id: parseInt(this.config.auth.id as string, 10),
            privateKey: await fs.readFile(this.config.auth.privateKeyFile, "utf-8"),
            installationId: parseInt(this.config.installationId as string, 10),
        };

        this.internalOctokit = new Octokit({
            authStrategy: createAppAuth,
            auth,
            userAgent: "matrix-github v0.0.1",
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