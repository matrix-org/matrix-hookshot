import { JiraAccount, JiraComment, JiraIssue, JiraVersion } from "./Types";

export interface IJiraWebhookEvent {
    timestamp: number;
    webhookEvent: string;
}

export interface JiraCommentCreatedEvent extends IJiraWebhookEvent {
    webhookEvent: "comment_created";
    comment: JiraComment;
    issue: JiraIssue;
}

export interface JiraIssueEvent extends IJiraWebhookEvent {
    webhookEvent: "issue_updated"|"issue_created";
    comment: JiraComment;
    issue: JiraIssue;
}

export interface JiraIssueUpdatedEvent extends JiraIssueEvent {
    webhookEvent: "issue_updated";
    user: JiraAccount;
    changelog: {
        id: string;
        items: {
            field: string;
            fieldtype: string;
            fieldId: string;
            from: string|null;
            fromString: string|null;
            to: string|null;
            toString: null;
        }[];
    }
}

export interface JiraVersionEvent extends IJiraWebhookEvent {
    webhookEvent: "version_created"|"version_updated"|"version_released";
    version: JiraVersion;
}