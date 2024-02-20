import { ProvisioningStore } from "matrix-appservice-bridge";
import { IAppserviceStorageProvider, IStorageProvider } from "matrix-bot-sdk";
import { IssuesGetResponseData } from "../github/Types";
import { SerializedGitlabDiscussionThreads } from "../Gitlab/Types";

// Some RSS feeds can return a very small number of items then bounce
// back to their "normal" size, so we cannot just clobber the recent GUID list per request or else we'll
// forget what we sent and resend it. Instead, we'll keep 2x the max number of items that we've ever
// seen from this feed, up to a max of 10,000.
// Adopted from https://github.com/matrix-org/go-neb/blob/babb74fa729882d7265ff507b09080e732d060ae/services/rssbot/rssbot.go#L304
export const MAX_FEED_ITEMS = 10_000;

export interface IBridgeStorageProvider extends IAppserviceStorageProvider, IStorageProvider, ProvisioningStore {
    connect?(): Promise<void>;
    disconnect?(): Promise<void>;
    setGithubIssue(repo: string, issueNumber: string, data: IssuesGetResponseData, scope?: string): Promise<void>;
    getGithubIssue(repo: string, issueNumber: string, scope?: string): Promise<IssuesGetResponseData|null>;
    setLastNotifCommentUrl(repo: string, issueNumber: string, url: string, scope?: string): Promise<void>;
    getLastNotifCommentUrl(repo: string, issueNumber: string, scope?: string): Promise<string|null>;
    setPRReviewData(repo: string, issueNumber: string, data: unknown, scope?: string): Promise<void>;
    getPRReviewData(repo: string, issueNumber: string, scope?: string): Promise<any|null>;
    setFigmaCommentEventId(roomId: string, figmaCommentId: string, eventId: string): Promise<void>;
    getFigmaCommentEventId(roomId: string, figmaCommentId: string): Promise<string|null>;
    getStoredTempFile(key: string): Promise<string|null>;
    setStoredTempFile(key: string, value: string): Promise<void>;
    getGitlabDiscussionThreads(connectionId: string): Promise<SerializedGitlabDiscussionThreads>;
    setGitlabDiscussionThreads(connectionId: string, value: SerializedGitlabDiscussionThreads): Promise<void>;
    storeFeedGuids(url: string, ...guids: string[]): Promise<void>;
    hasSeenFeed(url: string): Promise<boolean>;
    hasSeenFeedGuids(url: string, ...guids: string[]): Promise<string[]>;
}