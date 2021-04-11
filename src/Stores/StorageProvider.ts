import { IAppserviceStorageProvider } from "matrix-bot-sdk";
import { IssuesGetResponseData } from "../Github/Types";

export interface IStorageProvider extends IAppserviceStorageProvider {
    setGithubIssue(repo: string, issueNumber: string, data: IssuesGetResponseData, scope?: string): Promise<void>;
    getGithubIssue(repo: string, issueNumber: string, scope?: string): Promise<IssuesGetResponseData|null>;
    setLastNotifCommentUrl(repo: string, issueNumber: string, url: string, scope?: string): Promise<void>;
    getLastNotifCommentUrl(repo: string, issueNumber: string, scope?: string): Promise<string|null>;
    setPRReviewData(repo: string, issueNumber: string, data: unknown, scope?: string): Promise<void>;
    getPRReviewData(repo: string, issueNumber: string, scope?: string): Promise<any|null>;
}