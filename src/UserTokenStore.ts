import { Intent } from "matrix-bot-sdk";
import { promises as fs } from "fs";
import { publicEncrypt, privateDecrypt } from "crypto";
import LogWrapper from "./LogWrapper";
import { Octokit } from "@octokit/rest";
import { createTokenAuth } from "@octokit/auth-token";
import { GitLabClient } from "./Gitlab/Client";

const ACCOUNT_DATA_TYPE = "uk.half-shot.matrix-github.password-store:";
const ACCOUNT_DATA_GITLAB_TYPE = "uk.half-shot.matrix-github.gitlab.password-store:";
const log = new LogWrapper("UserTokenStore");

export class UserTokenStore {
    private key!: Buffer;
    private userTokens: Map<string, string>;
    constructor(private keyPath: string, private intent: Intent) {
        this.userTokens = new Map();
    }

    public async load() {
        log.info(`Loading token key file ${this.keyPath}`);
        this.key = await fs.readFile(this.keyPath);
    }

    public async storeUserToken(type: "github"|"gitlab", userId: string, token: string, instance?: string): Promise<void> {
        let prefix = type === "github" ?  ACCOUNT_DATA_TYPE : ACCOUNT_DATA_GITLAB_TYPE;
        await this.intent.underlyingClient.setAccountData(`${prefix}${userId}`, {
            encrypted: publicEncrypt(this.key, Buffer.from(token)).toString("base64"),
            instance: instance,
        });
        this.userTokens.set(userId, token);
        log.info(`Stored new ${type} token for ${userId}`);
    }

    public async getUserToken(type: "github"|"gitlab", userId: string, instance?: string): Promise<string|null> {
        if (this.userTokens.has(userId)) {
            return this.userTokens.get(userId)!;
        }
        let obj;
        try {
            if (type === "github") {
                obj = await this.intent.underlyingClient.getAccountData(`${ACCOUNT_DATA_TYPE}${userId}`);
            } else if (type === "gitlab") {
                obj = await this.intent.underlyingClient.getAccountData(`${ACCOUNT_DATA_GITLAB_TYPE}${instance}${userId}`);
            }
            const encryptedTextB64 = obj.encrypted;
            const encryptedText = Buffer.from(encryptedTextB64, "base64");
            const token = privateDecrypt(this.key, encryptedText).toString("utf-8");
            this.userTokens.set(userId, token);
            return token;
        } catch (ex) {
            log.error(`Failed to get token for user ${userId}`);
            log.debug(ex);
        }
        return null;
    }

    public async getOctokitForUser(userId: string) {
        // TODO: Move this somewhere else.
        const senderToken = await this.getUserToken("github", userId);
        if (!senderToken) {
            return null;
        }
        return new Octokit({
            authStrategy: createTokenAuth,
            auth: senderToken,
            userAgent: "matrix-github v0.0.1",
        });
    }

    public async getGitLabForUser(userId: string, instanceUrl: string) {
        // TODO: Move this somewhere else.
        const senderToken = await this.getUserToken("gitlab", userId, instanceUrl);
        if (!senderToken) {
            return null;
        }
        return new GitLabClient(instanceUrl, senderToken);
    }
}
