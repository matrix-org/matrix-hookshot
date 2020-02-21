import { Redis, default as redis } from "ioredis";
import { LogWrapper } from "../LogWrapper";
import { IStorageProvider } from "./StorageProvider";

const REGISTERED_USERS_KEY = "as.registered_users";
const COMPLETED_TRANSACTIONS_KEY = "as.completed_transactions";
const GH_ISSUES_KEY = "gh.issues";
const COMPLETED_TRANSACTIONS_EXPIRE_AFTER = 24 * 60 * 60; // 24 hours

const log = new LogWrapper("RedisASProvider");

export class RedisStorageProvider implements IStorageProvider {
    private redis: Redis;

    constructor(host: string, port: number) {
        this.redis = redis(port, host);
        this.redis.expire(COMPLETED_TRANSACTIONS_KEY, COMPLETED_TRANSACTIONS_EXPIRE_AFTER).catch((ex) => {
            log.warn("Failed to set expiry time on as.completed_transactions");
        });
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

    public async setGithubIssue(repo: string, issueNumber: string, data: any) {
        await this.redis.set(`${GH_ISSUES_KEY}:${repo}/${issueNumber}`, JSON.stringify(data));
    }

    public async getGithubIssue(repo: string, issueNumber: string) {
        const res = await this.redis.get(`${GH_ISSUES_KEY}:${repo}/${issueNumber}`);
        return res ? JSON.parse(res) : null;
    }
}
