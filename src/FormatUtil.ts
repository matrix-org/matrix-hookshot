import { IssuesGetResponse } from "@octokit/rest";

export class FormatUtil {
    public static formatName(issue: IssuesGetResponse) {
        const orgRepoName = issue.repository_url.substr("https://api.github.com/repos/".length);
        return `${orgRepoName}#${issue.number}: ${issue.title}`;
    }

    public static formatTopic(issue: IssuesGetResponse) {
        return `${issue.title} | Status: ${issue.state} | ${issue.html_url}`;
    }
}
