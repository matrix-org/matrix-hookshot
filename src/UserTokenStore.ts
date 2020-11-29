import { Intent } from "matrix-bot-sdk";
import { promises as fs } from "fs";
import { publicEncrypt, privateDecrypt } from "crypto";
import LogWrapper from "./LogWrapper";
import { GitLabClient } from "./Gitlab/Client";
import { GithubInstance } from "./Github/GithubInstance";

const ACCOUNT_DATA_TYPE = "uk.half-shot.matrix-github.password-store:";
const ACCOUNT_DATA_GITLAB_TYPE = "uk.half-shot.matrix-github.gitlab.password-store:";
const log = new LogWrapper("UserTokenStore");

function tokenKey(type: "github"|"gitlab", userId: string, instanceUrl?: string) {
    if (type === "github") {
        return `${ACCOUNT_DATA_TYPE}${userId}`;
    }
    return `${ACCOUNT_DATA_GITLAB_TYPE}${instanceUrl}${userId}`;
}

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

    public async storeUserToken(type: "github"|"gitlab", userId: string, token: string, instanceUrl?: string): Promise<void> {
        const key = tokenKey(type, userId, instanceUrl);
        const data = {
            encrypted: publicEncrypt(this.key, Buffer.from(token)).toString("base64"),
            instance: instanceUrl,
        };
        await this.intent.underlyingClient.setAccountData(key, data);
        this.userTokens.set(key, token);
        log.info(`Stored new ${type} token for ${userId}`);
        log.debug(`Stored`, data);
    }

    public async getUserToken(type: "github"|"gitlab", userId: string, instanceUrl?: string): Promise<string|null> {
        const key = tokenKey(type, userId, instanceUrl);
        const existingToken = this.userTokens.get(key);
        if (existingToken) {
            return existingToken;
        }
        let obj;
        try {
            if (type === "github") {
                obj = await this.intent.underlyingClient.getAccountData(key);
            } else if (type === "gitlab") {
                obj = await this.intent.underlyingClient.getAccountData(key);
            }
            const encryptedTextB64 = obj.encrypted;
            const encryptedText = Buffer.from(encryptedTextB64, "base64");
            const token = privateDecrypt(this.key, encryptedText).toString("utf-8");
            this.userTokens.set(key, token);
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
        return GithubInstance.createUserOctokit(senderToken);
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
