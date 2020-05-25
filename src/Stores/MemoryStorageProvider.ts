import { MemoryStorageProvider as MSP } from "matrix-bot-sdk";
import { IStorageProvider } from "./StorageProvider";

export class MemoryStorageProvider extends MSP implements IStorageProvider {
    private issues: Map<string, any> = new Map();
    private issuesLastComment: Map<string, string> = new Map();
    private reviewData: Map<string, string> = new Map();
    private snoozeDate: Map<string, number> = new Map();
    constructor() {
        super();
    }

    public async setGithubIssue(repo: string, issueNumber: string, data: any, scope: string = "") {
        this.issues.set(`${scope}${repo}/${issueNumber}`, data);
    }

    public async getGithubIssue(repo: string, issueNumber: string, scope: string = "") {
        return this.issues.get(`${scope}${repo}/${issueNumber}`) || null;
    }

    public async setLastNotifCommentUrl(repo: string, issueNumber: string, url: string, scope: string = "") {
        this.issuesLastComment.set(`${scope}${repo}/${issueNumber}`, url);
    }

    public async getLastNotifCommentUrl(repo: string, issueNumber: string, scope: string = "") {
        return this.issuesLastComment.get(`${scope}${repo}/${issueNumber}`) || null;
    }

    public async setPRReviewData(repo: string, issueNumber: string, data: any, scope: string = "") {
        const key = `${scope}:${repo}/${issueNumber}`;
        this.reviewData.set(key, data);
    }

    public async getPRReviewData(repo: string, issueNumber: string, scope: string = "") {
        const key = `${scope}:${repo}/${issueNumber}`;
        return this.reviewData.get(key) || null;
    }
}
