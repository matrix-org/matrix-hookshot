import { GithubInstance } from "./Github/GithubInstance";
import { GitLabClient } from "./Gitlab/Client";
import { Intent } from "matrix-bot-sdk";
import { promises as fs } from "fs";
import { publicEncrypt, privateDecrypt } from "crypto";
import LogWrapper from "./LogWrapper";
import { CLOUD_INSTANCE, isJiraCloudInstance, JiraClient } from "./Jira/Client";
import { JiraStoredToken } from "./Jira/Types";
import { BridgeConfig, BridgeConfigJiraOnPremOAuth, BridgePermissionLevel } from "./Config/Config";
import { v4 as uuid } from "uuid";
import { GitHubOAuthToken } from "./Github/Types";
import { ApiError, ErrCode } from "./api";
import { JiraOAuth } from "./Jira/OAuth";
import { JiraCloudOAuth } from "./Jira/oauth/CloudOAuth";
import { JiraOnPremOAuth } from "./Jira/oauth/OnPremOAuth";
import { JiraOnPremClient } from "./Jira/client/OnPremClient";
import { JiraCloudClient } from "./Jira/client/CloudClient";
import { TokenError, TokenErrorCode } from "./errors";

const ACCOUNT_DATA_TYPE = "uk.half-shot.matrix-hookshot.github.password-store:";
const ACCOUNT_DATA_GITLAB_TYPE = "uk.half-shot.matrix-hookshot.gitlab.password-store:";
const ACCOUNT_DATA_JIRA_TYPE = "uk.half-shot.matrix-hookshot.jira.password-store:";

const LEGACY_ACCOUNT_DATA_TYPE = "uk.half-shot.matrix-github.password-store:";
const LEGACY_ACCOUNT_DATA_GITLAB_TYPE = "uk.half-shot.matrix-github.gitlab.password-store:";

const log = new LogWrapper("UserTokenStore");
type TokenType = "github"|"gitlab"|"jira";
const AllowedTokenTypes = ["github", "gitlab", "jira"];

interface StoredTokenData {
    encrypted: string|string[];
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

const MAX_TOKEN_PART_SIZE = 128;
const OAUTH_TIMEOUT_MS = 1000 * 60 * 30;
export class UserTokenStore {
    private key!: Buffer;
    private oauthSessionStore: Map<string, {userId: string, timeout: NodeJS.Timeout}> = new Map();
    private userTokens: Map<string, string>;
    public readonly jiraOAuth?: JiraOAuth;
    constructor(private keyPath: string, private intent: Intent, private config: BridgeConfig) {
        this.userTokens = new Map();
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

    public async load() {
        log.info(`Loading token key file ${this.keyPath}`);
        this.key = await fs.readFile(this.keyPath);
    }

    public async storeUserToken(type: TokenType, userId: string, token: string, instanceUrl?: string): Promise<void> {
        if (!this.config.checkPermission(userId, type, BridgePermissionLevel.login)) {
            throw new ApiError('User does not have permission to log in to service', ErrCode.ForbiddenUser);
        }
        const key = tokenKey(type, userId, false, instanceUrl);
        const tokenParts: string[] = [];
        while (token && token.length > 0) {
            const part = token.slice(0, MAX_TOKEN_PART_SIZE);
            token = token.substring(MAX_TOKEN_PART_SIZE);
            tokenParts.push(publicEncrypt(this.key, Buffer.from(part)).toString("base64"));
        }
        const data: StoredTokenData = {
            encrypted: tokenParts,
            instance: instanceUrl,
        };
        await this.intent.underlyingClient.setAccountData(key, data);
        this.userTokens.set(key, token);
        log.info(`Stored new ${type} token for ${userId}`);
        log.debug(`Stored`, data);
    }

    public async clearUserToken(type: TokenType, userId: string, instanceUrl?: string): Promise<boolean> {
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
            const encryptedParts = typeof obj.encrypted === "string" ? [obj.encrypted] : obj.encrypted;
            const token = encryptedParts.map((t) => privateDecrypt(this.key, Buffer.from(t, "base64")).toString("utf-8")).join("");
            this.userTokens.set(key, token);
            return token;
        } catch (ex) {
            log.error(`Failed to get ${type} token for user ${userId}`, ex);
        }
        return null;
    }

    public async getGitHubToken(userId: string) {
        const storeTokenResponse = await this.getUserToken("github", userId);
        if (!storeTokenResponse) {
            return null;
        }

        let senderToken: GitHubOAuthToken;
        if (!storeTokenResponse.startsWith('{')) {
            // Old style token
            senderToken = { access_token: storeTokenResponse, token_type: 'pat' };
        } else {
            senderToken = JSON.parse(storeTokenResponse);
        }
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
                    this.config.github?.oauth?.client_id,
                    this.config.github?.oauth?.client_secret,
                );
                if (!senderToken.access_token) {
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
        const res = await this.getGitHubToken(userId);
        return res ? GithubInstance.createUserOctokit(res) : null;
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

        let instance = instanceUrl ? new URL(instanceUrl).host : CLOUD_INSTANCE;

        if (isJiraCloudInstance(instance)) {
            instance = CLOUD_INSTANCE;
        }

        let jsonData = await this.getUserToken("jira", userId, instance);
        // XXX: Legacy fallback
        if (!jsonData && instance === CLOUD_INSTANCE) {
            jsonData = await this.getUserToken("jira", userId);
        }
        if (!jsonData) {
            return null;
        }
        const storedToken = JSON.parse(jsonData) as JiraStoredToken;
        if (!storedToken.instance) {
            // Legacy stored tokens don't include the cloud instance string.
            storedToken.instance = CLOUD_INSTANCE;
        }
        if (storedToken.instance === CLOUD_INSTANCE) {
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
        const state = uuid();
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
