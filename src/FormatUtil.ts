import { Octokit } from "@octokit/rest";

interface IMinimalRepository {
    id: number;
    full_name: string;
    html_url: string;
}

export class FormatUtil {
    public static formatIssueRoomName(issue: {number: number, title: string, repository_url: string}) {
        const orgRepoName = issue.repository_url.substr("https://api.github.com/repos/".length);
        return `${orgRepoName}#${issue.number}: ${issue.title}`;
    }

    public static formatRepoRoomName(repo: {full_name: string, url: string}) {
        const orgRepoName = repo.url.substr("https://api.github.com/repos/".length);
        return `${orgRepoName}: ${repo.full_name}`;
    }

    public static formatRoomTopic(repo: {state: string, html_url: string}) {
        return `Status: ${repo.state} | ${repo.html_url}`;
    }

    public static formatRepoRoomTeam(repo: {html_url: string}) {
        return `${repo.html_url}`;
    }

    public static getPartialBodyForRepo(repo: IMinimalRepository) {
        return {
            "external_url": repo.html_url,
            "uk.half-shot.matrix-github.repo": {
                id: repo.id,
                name: repo.full_name,
                url: repo.html_url,
            },
        };
    }

    public static getPartialBodyForIssue(repo: IMinimalRepository, issue: Octokit.IssuesGetResponse) {
        return {
            ...FormatUtil.getPartialBodyForRepo(repo),
            "external_url": issue.html_url,
            "uk.half-shot.matrix-github.issue": {
                id: issue.id,
                number: issue.number,
                title: issue.title,
                is_pull_request: !!issue.pull_request,
                url: issue.html_url,
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

    public static projectListing(projectItem: Octokit.ProjectsListForOrgResponseItem|Octokit.ProjectsListForUserResponseItem|Octokit.ProjectsListForRepoResponseItem) {
        return `${projectItem.name} (#${projectItem.number}) - Project ID: ${projectItem.id}`
    }
}
