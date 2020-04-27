import { IAppserviceStorageProvider } from "matrix-bot-sdk";

export interface IStorageProvider extends IAppserviceStorageProvider {
    setGithubIssue(repo: string, issueNumber: string, data: any, scope?: string): Promise<void>;
    getGithubIssue(repo: string, issueNumber: string, scope?: string): Promise<any|null>;
    setLastNotifCommentUrl(repo: string, issueNumber: string, url: string, scope?: string): Promise<void>;
    getLastNotifCommentUrl(repo: string, issueNumber: string, scope?: string): Promise<string|null>;
    setPRReviewData(repo: string, issueNumber: string, data: any, scope?: string): Promise<void>;
    getPRReviewData(repo: string, issueNumber: string, scope?: string): Promise<any|null>;
}