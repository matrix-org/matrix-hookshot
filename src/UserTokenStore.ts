import { GithubInstance } from "./Github/GithubInstance";
import { GitLabClient } from "./Gitlab/Client";
import { Intent } from "matrix-bot-sdk";
import { promises as fs } from "fs";
import { publicEncrypt, privateDecrypt } from "crypto";
import LogWrapper from "./LogWrapper";
import { JiraClient } from "./Jira/Client";
import { JiraOAuthResult } from "./Jira/Types";
import { BridgeConfig } from "./Config/Config";
import { v4 as uuid } from "uuid";

const ACCOUNT_DATA_TYPE = "uk.half-shot.matrix-hookshot.github.password-store:";
const ACCOUNT_DATA_GITLAB_TYPE = "uk.half-shot.matrix-hookshot.gitlab.password-store:";
const ACCOUNT_DATA_JIRA_TYPE = "uk.half-shot.matrix-hookshot.jira.password-store:";

const LEGACY_ACCOUNT_DATA_TYPE = "uk.half-shot.matrix-github.password-store:";
const LEGACY_ACCOUNT_DATA_GITLAB_TYPE = "uk.half-shot.matrix-github.gitlab.password-store:";

const log = new LogWrapper("UserTokenStore");
type TokenType = "github"|"gitlab"|"jira";
const AllowedTokenTypes = ["github", "gitlab", "jira"];

function tokenKey(type: TokenType, userId: string, legacy = false, instanceUrl?: string) {
    if (type === "github") {
        return `${legacy ? LEGACY_ACCOUNT_DATA_TYPE : ACCOUNT_DATA_TYPE}${userId}`;
    }
    if (type === "jira") {
        return `${ACCOUNT_DATA_JIRA_TYPE}${userId}`;
    }
    if (!instanceUrl) {
        throw Error(`Expected instanceUrl for ${type}`);
    }
    return `${legacy ? LEGACY_ACCOUNT_DATA_GITLAB_TYPE : ACCOUNT_DATA_GITLAB_TYPE}${instanceUrl}${userId}`;
}

const MAX_TOKEN_PART_SIZE = 128;
const OAUTH_TIMEOUT_MS = 1000 * 60 * 30;
export class UserTokenStore {
    private key!: Buffer;
    private oauthSessionStore: Map<string, {userId: string, timeout: NodeJS.Timeout}> = new Map();
    private userTokens: Map<string, string>;
    constructor(private keyPath: string, private intent: Intent, private config: BridgeConfig) {
        this.userTokens = new Map();
    }

    public async load() {
        log.info(`Loading token key file ${this.keyPath}`);
        this.key = await fs.readFile(this.keyPath);
    }

    public async storeUserToken(type: TokenType, userId: string, token: string, instanceUrl?: string): Promise<void> {
        const key = tokenKey(type, userId, false, instanceUrl);
        const tokenParts: string[] = [];
        while (token && token.length > 0) {
            const part = token.slice(0, MAX_TOKEN_PART_SIZE);
            token = token.substring(MAX_TOKEN_PART_SIZE);
            tokenParts.push(publicEncrypt(this.key, Buffer.from(part)).toString("base64"));
        }
        const data = {
            encrypted: tokenParts,
            instance: instanceUrl,
        };
        await this.intent.underlyingClient.setAccountData(key, data);
        this.userTokens.set(key, token);
        log.info(`Stored new ${type} token for ${userId}`);
        log.debug(`Stored`, data);
    }

    public async getUserToken(type: TokenType, userId: string, instanceUrl?: string): Promise<string|null> {
        const key = tokenKey(type, userId, false, instanceUrl);
        const existingToken = this.userTokens.get(key);
        if (existingToken) {
            return existingToken;
        }
        try {
            let obj;
            if (AllowedTokenTypes.includes(type)) {
                obj = await this.intent.underlyingClient.getSafeAccountData<{encrypted: string|string[]}>(key);
                if (!obj) {
                    obj = await this.intent.underlyingClient.getAccountData<{encrypted: string|string[]}>(tokenKey(type, userId, true, instanceUrl));
                }
            } else {
                throw Error('Unknown type');
            }
            const encryptedParts = typeof obj.encrypted === "string" ? [obj.encrypted] : obj.encrypted;
            const token = encryptedParts.map((t) => privateDecrypt(this.key, Buffer.from(t, "base64")).toString("utf-8")).join("");
            this.userTokens.set(key, token);
            return token;
        } catch (ex) {
            log.error(`Failed to get ${type} token for user ${userId}`);
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

    public async getJiraForUser(userId: string) {
        if (!this.config.jira?.oauth) {
            throw Error('Jira not configured');
        }
        const jsonData = await this.getUserToken("jira", userId);
        if (!jsonData) {
            return null;
        }
        // TODO: Hacks
        return new JiraClient(JSON.parse(jsonData) as JiraOAuthResult, (data) => {
            return this.storeUserToken('jira', userId, JSON.stringify(data));
        }, this.config.jira);
    }

    public createStateForOAuth(userId: string): string {
        const state = uuid();
        this.oauthSessionStore.set(state, {
            userId,
            timeout: setTimeout(() => this.oauthSessionStore.delete(state), OAUTH_TIMEOUT_MS),
        });
        return state;
    }

    public getUserIdForOAuthState(state: string) {
        const result = this.oauthSessionStore.get(state);
        if (!result) {
            return null;
        }
        clearTimeout(result.timeout);
        this.oauthSessionStore.delete(state);
        return result.userId;
    }
}
