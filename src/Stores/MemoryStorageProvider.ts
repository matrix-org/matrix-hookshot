import { MemoryStorageProvider as MSP } from "matrix-bot-sdk";
import { IBridgeStorageProvider } from "./StorageProvider";
import { IssuesGetResponseData } from "../Github/Types";

export class MemoryStorageProvider extends MSP implements IBridgeStorageProvider {
    private issues: Map<string, IssuesGetResponseData> = new Map();
    private issuesLastComment: Map<string, string> = new Map();
    private reviewData: Map<string, string> = new Map();
    constructor() {
        super();
    }

    public async setGithubIssue(repo: string, issueNumber: string, data: IssuesGetResponseData, scope = "") {
        this.issues.set(`${scope}${repo}/${issueNumber}`, data);
    }

    public async getGithubIssue(repo: string, issueNumber: string, scope = "") {
        return this.issues.get(`${scope}${repo}/${issueNumber}`) || null;
    }

    public async setLastNotifCommentUrl(repo: string, issueNumber: string, url: string, scope = "") {
        this.issuesLastComment.set(`${scope}${repo}/${issueNumber}`, url);
    }

    public async getLastNotifCommentUrl(repo: string, issueNumber: string, scope = "") {
        return this.issuesLastComment.get(`${scope}${repo}/${issueNumber}`) || null;
    }

    public async setPRReviewData(repo: string, issueNumber: string, data: any, scope = "") {
        const key = `${scope}:${repo}/${issueNumber}`;
        this.reviewData.set(key, data);
    }

    public async getPRReviewData(repo: string, issueNumber: string, scope = "") {
        const key = `${scope}:${repo}/${issueNumber}`;
        return this.reviewData.get(key) || null;
    }
}
