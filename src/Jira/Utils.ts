import { JiraIssue } from "./Types";

export function generateWebLinkFromIssue(issue: JiraIssue) {
    const { origin } = new URL(issue.self);
    return `${origin}/browse/${issue.key}`
}