import { GithubInstance } from "../github/GithubInstance";
import { GitLabClient } from "../Gitlab/Client";
import { Intent } from "matrix-bot-sdk";
import { promises as fs } from "fs";
import { Logger } from "matrix-appservice-bridge";
import { isJiraCloudInstance, JiraClient } from "../jira/Client";
import { JiraStoredToken } from "../jira/Types";
import { BridgeConfig, BridgeConfigJira, BridgeConfigJiraOnPremOAuth, BridgePermissionLevel } from "../config/Config";
import { randomUUID } from 'node:crypto';
import { GitHubOAuthToken } from "../github/Types";
import { ApiError, ErrCode } from "../api";
import { JiraOAuth } from "../jira/OAuth";
import { JiraCloudOAuth } from "../jira/oauth/CloudOAuth";
import { JiraOnPremOAuth } from "../jira/oauth/OnPremOAuth";
import { JiraOnPremClient } from "../jira/client/OnPremClient";
import { JiraCloudClient } from "../jira/client/CloudClient";
import { TokenError, TokenErrorCode } from "../errors";
import { TypedEmitter } from "tiny-typed-emitter";
import { hashId, TokenEncryption, stringToAlgo } from "../libRs"; 

const ACCOUNT_DATA_TYPE = "uk.half-shot.matrix-hookshot.github.password-store:";
const ACCOUNT_DATA_GITLAB_TYPE = "uk.half-shot.matrix-hookshot.gitlab.password-store:";
const ACCOUNT_DATA_JIRA_TYPE = "uk.half-shot.matrix-hookshot.jira.password-store:";

const LEGACY_ACCOUNT_DATA_TYPE = "uk.half-shot.matrix-github.password-store:";
const LEGACY_ACCOUNT_DATA_GITLAB_TYPE = "uk.half-shot.matrix-github.gitlab.password-store:";

const log = new Logger("UserTokenStore");
export type TokenType = "github"|"gitlab"|"jira"|"generic";
export const AllowedTokenTypes = ["github", "gitlab", "jira", "generic"];

interface StoredTokenData {
    encrypted: string|string[];
    keyId: string;
    algorithm: 'rsa'|'rsa-pkcs1v15';
    instance?: string;
}

interface DeletedTokenData {
    deleted: true;
}

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

const OAUTH_TIMEOUT_MS = 1000 * 60 * 30;

interface Emitter {
    onNewToken: (type: TokenType, userId: string, token: string, instanceUrl?: string) => void,
}
export class UserTokenStore extends TypedEmitter<Emitter> {

    public static async fromKeyPath(keyPath: string, intent: Intent, config: BridgeConfig) {
        log.info(`Loading token key file ${keyPath}`);
        const key = await fs.readFile(keyPath);
        return new UserTokenStore(key, intent, config);
    }
    
    private oauthSessionStore: Map<string, {userId: string, timeout: NodeJS.Timeout}> = new Map();
    private userTokens: Map<string, string>;
    public readonly jiraOAuth?: JiraOAuth;
    private tokenEncryption: TokenEncryption;
    private readonly keyId: string;
    constructor(key: Buffer, private readonly intent: Intent, private readonly config: BridgeConfig) {
        super();
        this.tokenEncryption = new TokenEncryption(key);
        this.userTokens = new Map();
        this.keyId = hashId(key.toString('utf-8'));
        if (config.jira?.oauth) {
            if ("client_id" in config.jira.oauth) {
                this.jiraOAuth = new JiraCloudOAuth(config.jira.oauth);
            } else if (config.jira.url) {
                this.jiraOAuth = new JiraOnPremOAuth(config.jira.oauth, config.jira.url);
            } else {
                throw Error('jira oauth misconfigured');
            }
        }
    }

    public stop() {
        for (const session of this.oauthSessionStore.values()) {
            clearTimeout(session.timeout);
        }
    }

    public async storeUserToken(type: TokenType, userId: string, token: string, instanceUrl?: string): Promise<void> {
        if (!this.config.checkPermission(userId, type, BridgePermissionLevel.login)) {
            throw new ApiError('User does not have permission to log in to service', ErrCode.ForbiddenUser);
        }
        const key = tokenKey(type, userId, false, instanceUrl);
        const tokenParts: string[] = this.tokenEncryption.encrypt(token);
        const data: StoredTokenData = {
            encrypted: tokenParts,
            keyId: this.keyId,
            algorithm: "rsa-pkcs1v15",
            instance: instanceUrl,
        };
        await this.intent.underlyingClient.setAccountData(key, data);
        this.userTokens.set(key, token);
        log.info(`Stored new ${type} token for ${userId}`);
        this.emit("onNewToken", type, userId, token, instanceUrl);
    }

    public async clearUserToken(type: TokenType, userId: string, instanceUrl?: string): Promise<boolean> {
        if (!AllowedTokenTypes.includes(type)) {
            throw Error('Unknown token type');
        }
        const key = tokenKey(type, userId, false, instanceUrl);
        const obj = await this.intent.underlyingClient.getSafeAccountData<StoredTokenData|DeletedTokenData>(key);
        if (!obj || "deleted" in obj) {
            // Token not stored
            return false;
        }
        await this.intent.underlyingClient.setAccountData(key, {deleted: true});
        this.userTokens.delete(key);
        return true;
    }

    public async storeJiraToken(userId: string, token: JiraStoredToken) {
        return this.storeUserToken("jira", userId, JSON.stringify(token));
    }

    public async getUserToken(type: TokenType, userId: string, instanceUrl?: string): Promise<string|null> {
        if (!AllowedTokenTypes.includes(type)) {
            throw Error('Unknown token type');
        }
        const key = tokenKey(type, userId, false, instanceUrl);
        const existingToken = this.userTokens.get(key);
        if (existingToken) {
            return existingToken;
        }
        try {
            let obj = await this.intent.underlyingClient.getSafeAccountData<StoredTokenData|DeletedTokenData>(key);
            if (!obj) {
                obj = await this.intent.underlyingClient.getSafeAccountData<StoredTokenData|DeletedTokenData>(tokenKey(type, userId, true, instanceUrl));
            }
            if (!obj || "deleted" in obj) {
                return null;
            }
            // For legacy we just assume it's the current configured key.
            const algorithm = stringToAlgo(obj.algorithm ?? "rsa");
            const keyId = obj.keyId ?? this.keyId;

            if (keyId !== this.keyId) {
                throw new Error(`Stored data was encrypted with a different key to the one currently configured`);
            }

            const encryptedParts = typeof obj.encrypted === "string" ? [obj.encrypted] : obj.encrypted;
            const token = this.tokenEncryption.decrypt(encryptedParts, algorithm);
            this.userTokens.set(key, token);
            return token;
        } catch (ex) {
            log.error(`Failed to get ${type} token for user ${userId}`, ex);
        }
        return null;
    }

    public async storeGenericToken(namespace: string, key: string, token: string) {
        const finalTokenKey = `generic:${namespace}:${key}`
        const tokenParts: string[] = this.tokenEncryption.encrypt(token);
        const data: StoredTokenData = {
            encrypted: tokenParts,
            keyId: this.keyId,
            algorithm: "rsa-pkcs1v15",
        };
        await this.intent.underlyingClient.setAccountData(finalTokenKey, data);
        log.debug(`Stored token ${namespace}`);
    }

    public async getGenericToken(namespace: string, key: string): Promise<string|null> {
        const finalTokenKey = `generic:${namespace}:${key}`
        const obj = await this.intent.underlyingClient.getSafeAccountData<StoredTokenData|DeletedTokenData>(finalTokenKey);
        if (!obj || "deleted" in obj) {
            return null;
        }
        // For legacy we just assume it's the current configured key.
        const algorithm = stringToAlgo(obj.algorithm ?? "rsa");
        const keyId = obj.keyId ?? this.keyId;

        if (keyId !== this.keyId) {
            throw new Error(`Stored data was encrypted with a different key to the one currently configured`);
        }

        const encryptedParts = typeof obj.encrypted === "string" ? [obj.encrypted] : obj.encrypted;
        const token = this.tokenEncryption.decrypt(encryptedParts, algorithm);
        return token;
    }

    public static parseGitHubToken(token: string): GitHubOAuthToken {
        if (!token.startsWith('{')) {
            // Old style token
            return { access_token: token, token_type: 'pat' };
        } else {
            return JSON.parse(token);
        }
    }

    public async getGitHubToken(userId: string) {
        const storeTokenResponse = await this.getUserToken("github", userId);
        if (!storeTokenResponse) {
            return null;
        }

        let senderToken = UserTokenStore.parseGitHubToken(storeTokenResponse);
        const date = Date.now();
        if (senderToken.expires_in && senderToken.expires_in < date) {
            log.info(`GitHub access token for ${userId} has expired ${senderToken.expires_in} < ${date}, attempting refresh`);
            if (!this.config.github?.oauth) {
                throw new TokenError(TokenErrorCode.EXPIRED, "GitHub oauth not configured, cannot refresh token");
            }
            if (senderToken.refresh_token && senderToken.refresh_token_expires_in && senderToken?.refresh_token_expires_in > date) {
                // Needs a refresh.
                const refreshResult = await GithubInstance.refreshAccessToken(
                    senderToken.refresh_token, 
                    this.config.github.oauth.client_id,
                    this.config.github.oauth.client_secret,
                    this.config.github.baseUrl
                );
                if (!refreshResult.access_token) {
                    throw Error('Refresh token response had the wrong response format!');
                }
                senderToken = {
                    access_token: refreshResult.access_token,
                    expires_in: refreshResult.expires_in && ((parseInt(refreshResult.expires_in) * 1000) + date),
                    token_type: refreshResult.token_type,
                    refresh_token: refreshResult.refresh_token,
                    refresh_token_expires_in: refreshResult.refresh_token_expires_in && ((parseInt(refreshResult.refresh_token_expires_in) * 1000)  + date),
                } as GitHubOAuthToken;
                await this.storeUserToken("github", userId, JSON.stringify(senderToken));
            } else {
                log.error(`GitHub access token for ${userId} has expired, and the refresh token is stale or not given`);
                throw new TokenError(TokenErrorCode.EXPIRED, `GitHub access token for ${userId} has expired, and the refresh token is stale or not given`);
            }
        }
        return senderToken.access_token;
    }

    public async getOctokitForUser(userId: string) {
        if (!this.config.github) {
            throw Error('GitHub is not configured');
        }
        const res = await this.getGitHubToken(userId);
        return res ? GithubInstance.createUserOctokit(res, this.config.github.baseUrl) : null;
    }

    public async getGitLabForUser(userId: string, instanceUrl: string) {
        const senderToken = await this.getUserToken("gitlab", userId, instanceUrl);
        if (!senderToken) {
            return null;
        }
        return new GitLabClient(instanceUrl, senderToken);
    }

    public async getJiraForUser(userId: string, instanceUrl?: string): Promise<JiraClient|null> {
        if (!this.config.jira?.oauth) {
            throw Error('Jira not configured');
        }

        let instance = instanceUrl && new URL(instanceUrl).host;

        if (!instance || isJiraCloudInstance(instance)) {
            instance = BridgeConfigJira.CLOUD_INSTANCE_NAME;
        }

        let jsonData = await this.getUserToken("jira", userId, instance);
        // XXX: Legacy fallback
        if (!jsonData && instance === BridgeConfigJira.CLOUD_INSTANCE_NAME) {
            jsonData = await this.getUserToken("jira", userId);
        }
        if (!jsonData) {
            return null;
        }
        const storedToken = JSON.parse(jsonData) as JiraStoredToken;
        if (!storedToken.instance) {
            // Legacy stored tokens don't include the cloud instance string.
            storedToken.instance = BridgeConfigJira.CLOUD_INSTANCE_NAME;
        }
        if (storedToken.instance === BridgeConfigJira.CLOUD_INSTANCE_NAME) {
            return new JiraCloudClient(storedToken, (data) => {
                return this.storeJiraToken(userId, data);
            }, this.config.jira, instance);
        } else if (this.config.jira.url) {
            return new JiraOnPremClient(
                storedToken,
                (this.jiraOAuth as JiraOnPremOAuth).privateKey,
                this.config.jira.oauth as BridgeConfigJiraOnPremOAuth,
                this.config.jira.url,
            );
        }
        throw Error('Could not determine type of client');
    }

    public createStateForOAuth(userId: string): string {
        const state = randomUUID();
        this.oauthSessionStore.set(state, {
            userId,
            timeout: setTimeout(() => this.oauthSessionStore.delete(state), OAUTH_TIMEOUT_MS),
        });
        return state;
    }

    public getUserIdForOAuthState(state: string, remove = true) {
        const result = this.oauthSessionStore.get(state);
        if (!result) {
            return null;
        }
        if (remove) {
            clearTimeout(result.timeout);
            this.oauthSessionStore.delete(state);
        }
        return result.userId;
    }
}
