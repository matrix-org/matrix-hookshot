import { Octokit } from "@octokit/rest";

interface IMinimalRepository {
    id: number;
    full_name: string;
    html_url: string;
}

export class FormatUtil {
    public static formatRoomName(issue: {number: number, title: string, repository_url: string}) {
        const orgRepoName = issue.repository_url.substr("https://api.github.com/repos/".length);
        return `${orgRepoName}#${issue.number}: ${issue.title}`;
    }

    public static formatRoomTopic(issue: {state: string, title: string, html_url: string}) {
        return `${issue.title} | Status: ${issue.state} | ${issue.html_url}`;
    }

    public static getPartialBodyForIssue(repo: IMinimalRepository, issue: Octokit.IssuesGetResponse) {
        return {
            "external_url": issue.html_url,
            "uk.half-shot.matrix-github.issue": {
                id: issue.id,
                number: issue.number,
                title: issue.title,
                is_pull_request: !!issue.pull_request,
                url: issue.html_url,
            },
            "uk.half-shot.matrix-github.repo": {
                id: repo.id,
                name: repo.full_name,
                url: repo.html_url,
            },
        };
    }

    public static getPartialBodyForComment(comment: Octokit.IssuesGetCommentResponse,
                                           repo?: IMinimalRepository,
                                           issue?: Octokit.IssuesGetResponse) {
        return {
            ...(issue && repo ? FormatUtil.getPartialBodyForIssue(repo, issue) : undefined),
            "external_url": comment.html_url,
            "uk.half-shot.matrix-github.comment": {
                id: comment.id,
            },
        };
    }
}
