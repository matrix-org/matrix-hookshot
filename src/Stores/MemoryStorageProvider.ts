import { MemoryStorageProvider as MSP } from "matrix-bot-sdk";
import { IStorageProvider } from "./StorageProvider";

export class MemoryStorageProvider extends MSP implements IStorageProvider {
    private issues: Map<string, any> = new Map();
    constructor() {
        super();
    }

    public async setGithubIssue(repo: string, issueNumber: string, data: any) {
        this.issues.set(`${repo}/${issueNumber}`, data);
    }

    public async getGithubIssue(repo: string, issueNumber: string) {
        return this.issues.get(`${repo}/${issueNumber}`) || null;
    }
}