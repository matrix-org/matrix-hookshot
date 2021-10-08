import { JiraComment, JiraIssue } from "./Types";

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