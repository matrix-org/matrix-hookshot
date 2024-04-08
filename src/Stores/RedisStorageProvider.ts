import { IssuesGetResponseData } from "../github/Types";
import { Redis, default as redis } from "ioredis";
import { Logger } from "matrix-appservice-bridge";

import { IBridgeStorageProvider, MAX_FEED_ITEMS } from "./StorageProvider";
import { IFilterInfo, IStorageProvider } from "matrix-bot-sdk";
import { ProvisionSession } from "matrix-appservice-bridge";
import { SerializedGitlabDiscussionThreads } from "../Gitlab/Types";
import { BridgeConfigCache } from "../config/sections";

const BOT_SYNC_TOKEN_KEY = "bot.sync_token.";
const BOT_FILTER_KEY = "bot.filter.";
const BOT_VALUE_KEY = "bot.value.";
const REGISTERED_USERS_KEY = "as.registered_users";
const COMPLETED_TRANSACTIONS_KEY = "as.completed_transactions";
const GH_ISSUES_KEY = "gh.issues";
const GH_ISSUES_LAST_COMMENT_KEY = "gh.issues.last_comment";
const GH_ISSUES_REVIEW_DATA_KEY = "gh.issues.review_data";
const FIGMA_EVENT_COMMENT_ID = "figma.comment_event_id";
const STORED_FILES_KEY = "storedfiles.";
const GL_DISCUSSIONTHREADS_KEY = "gl.discussion-threads";
const STORED_FILES_EXPIRE_AFTER = 24 * 60 * 60; // 24 hours
const COMPLETED_TRANSACTIONS_EXPIRE_AFTER = 24 * 60 * 60; // 24 hours
const ISSUES_EXPIRE_AFTER = 7 * 24 * 60 * 60; // 7 days
const ISSUES_LAST_COMMENT_EXPIRE_AFTER = 14 * 24 * 60 * 60; // 7 days


const WIDGET_TOKENS = "widgets.tokens.";
const WIDGET_USER_TOKENS = "widgets.user-tokens.";

const FEED_GUIDS = "feeds.guids.";

const log = new Logger("RedisASProvider");

export class RedisStorageContextualProvider implements IStorageProvider {

    constructor(protected readonly redis: Redis, protected readonly contextSuffix = '') { }

    public setSyncToken(token: string|null){
        if (token === null) {
            this.redis.del(BOT_SYNC_TOKEN_KEY + this.contextSuffix);
        } else {
            this.redis.set(BOT_SYNC_TOKEN_KEY + this.contextSuffix, token);
        }
    }

    public getSyncToken() {
        return this.redis.get(BOT_SYNC_TOKEN_KEY + this.contextSuffix);
    }

    public setFilter(filter: IFilterInfo) {
        this.redis.set(BOT_FILTER_KEY + this.contextSuffix, JSON.stringify(filter));
    }

    public async getFilter() {
        const value = await this.redis.get(BOT_FILTER_KEY + this.contextSuffix);
        return value && JSON.parse(value);
    }

    public storeValue(key: string, value: string) {
        this.redis.set(`${BOT_VALUE_KEY}${this.contextSuffix}.${key}`, value);
    }

    public readValue(key: string) {
        return this.redis.get(`${BOT_VALUE_KEY}${this.contextSuffix}.${key}`);
    }

}


export class RedisStorageProvider extends RedisStorageContextualProvider implements IBridgeStorageProvider {
    constructor(cacheConfig: BridgeConfigCache, contextSuffix = '') {
        super(new redis(cacheConfig.redisUri), contextSuffix);
        this.redis.expire(COMPLETED_TRANSACTIONS_KEY, COMPLETED_TRANSACTIONS_EXPIRE_AFTER).catch((ex) => {
            log.warn("Failed to set expiry time on as.completed_transactions", ex);
        });
        this.redis.expire(STORED_FILES_KEY, STORED_FILES_EXPIRE_AFTER).catch((ex) => {
            log.warn(`Failed to set expiry time on ${STORED_FILES_KEY}`, ex);
        });
    }

    public async connect(): Promise<void> {
        try {
            await this.redis.ping();
        } catch (ex) {
            log.error('Could not ping the redis instance, is it reachable?');
            throw ex;
        }
        log.info("Successfully connected");
        try {
            await this.redis.expire(COMPLETED_TRANSACTIONS_KEY, COMPLETED_TRANSACTIONS_EXPIRE_AFTER);
        } catch (ex) {
            log.warn("Failed to set expiry time on as.completed_transactions", ex);
        }
    }

    public async disconnect(): Promise<void> {
        await this.redis.quit();
    }

    public async addRegisteredUser(userId: string) {
        this.redis.sadd(REGISTERED_USERS_KEY, [userId]);
    }

    public async isUserRegistered(userId: string): Promise<boolean> {
        return (await this.redis.sismember(REGISTERED_USERS_KEY, userId)) === 1;
    }

    public async setTransactionCompleted(transactionId: string) {
        this.redis.sadd(COMPLETED_TRANSACTIONS_KEY, [transactionId]);
    }

    public async isTransactionCompleted(transactionId: string): Promise<boolean> {
        return (await this.redis.sismember(COMPLETED_TRANSACTIONS_KEY, transactionId)) === 1;
    }

    public async setGithubIssue(repo: string, issueNumber: string, data: IssuesGetResponseData, scope = "") {
        const key = `${scope}${GH_ISSUES_KEY}:${repo}/${issueNumber}`;
        await this.redis.set(key, JSON.stringify(data));
        await this.redis.expire(key, ISSUES_EXPIRE_AFTER);
    }

    public async getGithubIssue(repo: string, issueNumber: string, scope = "") {
        const res = await this.redis.get(`${scope}:${GH_ISSUES_KEY}:${repo}/${issueNumber}`);
        return res ? JSON.parse(res) : null;
    }

    public async setLastNotifCommentUrl(repo: string, issueNumber: string, url: string, scope = "") {
        const key = `${scope}${GH_ISSUES_LAST_COMMENT_KEY}:${repo}/${issueNumber}`;
        await this.redis.set(key, url);
        await this.redis.expire(key, ISSUES_LAST_COMMENT_EXPIRE_AFTER);
    }

    public async getLastNotifCommentUrl(repo: string, issueNumber: string, scope = "") {
        const res = await this.redis.get(`${scope}:${GH_ISSUES_LAST_COMMENT_KEY}:${repo}/${issueNumber}`);
        return res ? res : null;
    }

    public async setPRReviewData(repo: string, issueNumber: string, url: string, scope = "") {
        const key = `${scope}${GH_ISSUES_REVIEW_DATA_KEY}:${repo}/${issueNumber}`;
        await this.redis.set(key, url);
        await this.redis.expire(key, ISSUES_LAST_COMMENT_EXPIRE_AFTER);
    }

    public async getPRReviewData(repo: string, issueNumber: string, scope = "") {
        const res = await this.redis.get(`${scope}:${GH_ISSUES_REVIEW_DATA_KEY}:${repo}/${issueNumber}`);
        return res ? res : null;
    }

    private static figmaCommentKey(roomId: string, figmaCommentId: string) {
        return `${FIGMA_EVENT_COMMENT_ID}:${roomId}:${figmaCommentId}`;
    }

    public async setFigmaCommentEventId(roomId: string, figmaCommentId: string, eventId: string) {
        await this.redis.set(RedisStorageProvider.figmaCommentKey(roomId, figmaCommentId), eventId);
    }

    public async getFigmaCommentEventId(roomId: string, figmaCommentId: string) {
        return this.redis.get(RedisStorageProvider.figmaCommentKey(roomId, figmaCommentId));
    }

    // Widget API sessions

    async getSessionForToken(token: string) {
        const json = await this.redis.get(`${WIDGET_TOKENS}${token}`);
        if (json) {
            return {
                ...JSON.parse(json),
                token,
            } as ProvisionSession;
        }
        return null;
    }

    async createSession(session: ProvisionSession) {
        await this.redis.set(`${WIDGET_TOKENS}${session.token}`, JSON.stringify({ userId: session.userId, expiresTs: session.expiresTs }));
        await this.redis.sadd(`${WIDGET_USER_TOKENS}${session.userId}`, session.token);
    }

    async deleteSession(token: string) {
        await this.redis.del(`${WIDGET_TOKENS}${token}`);
        await this.redis.srem(`${WIDGET_USER_TOKENS}${token}`, token);
    }

    async deleteAllSessions(userId: string) {
        let token = await this.redis.spop(`${WIDGET_USER_TOKENS}${userId}`);
        while (token) {
            await this.redis.del(`${WIDGET_TOKENS}${token}`);
            token = await this.redis.spop(`${WIDGET_USER_TOKENS}${userId}`);
        }
    }

    storageForUser(userId: string) {
        const newContext = [userId];
        if (this.contextSuffix) {
            newContext.push(this.contextSuffix);
        }
        return new RedisStorageContextualProvider(this.redis, newContext.join("."));
    }

    public async getStoredTempFile(key: string) {
        return this.redis.get(STORED_FILES_KEY + key);
    }
    
    public async setStoredTempFile(key: string, value: string) {
        await this.redis.set(STORED_FILES_KEY + key, value);
    }

    public async getGitlabDiscussionThreads(connectionId: string): Promise<SerializedGitlabDiscussionThreads> {
        const key = `${GL_DISCUSSIONTHREADS_KEY}:${connectionId}`;
        return JSON.parse(await this.redis.get(key) ?? '[]');
    }

    public async setGitlabDiscussionThreads(connectionId: string, value: SerializedGitlabDiscussionThreads): Promise<void> {
        const key = `${GL_DISCUSSIONTHREADS_KEY}:${connectionId}`;
        await this.redis.set(key, JSON.stringify(value));
    }

    public async storeFeedGuids(url: string, ...guids: string[]): Promise<void> {
        const feedKey = `${FEED_GUIDS}${url}`;
        await this.redis.lpush(feedKey, ...guids);
        await this.redis.ltrim(feedKey, 0, MAX_FEED_ITEMS);
    }

    public async hasSeenFeed(url: string): Promise<boolean> {
        return (await this.redis.exists(`${FEED_GUIDS}${url}`)) === 1;
    }

    public async hasSeenFeedGuids(url: string, ...guids: string[]): Promise<string[]> {
        let multi = this.redis.multi();
        const feedKey = `${FEED_GUIDS}${url}`;

        for (const guid of guids) {
            multi = multi.lpos(feedKey, guid);
        }
        const res = await multi.exec();
        if (res === null) {
            // Just assume we've seen none.
            return [];
        }
        return guids.filter((_guid, index) => res[index][1] !== null);
    }
}
