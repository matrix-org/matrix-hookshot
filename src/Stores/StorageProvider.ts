import { IAppserviceStorageProvider } from "matrix-bot-sdk";

export interface IStorageProvider extends IAppserviceStorageProvider {
    setGithubIssue(repo: string, issueNumber: string, data: any): Promise<void>;
    getGithubIssue(repo: string, issueNumber: string): Promise<any|null>;
}