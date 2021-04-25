/* eslint-disable camelcase */
import { IssuesGetCommentResponseData, IssuesGetResponseData, ProjectsListResponseData } from './Github/Types';
import emoji from "node-emoji";
interface IMinimalRepository {
    id: number;
    full_name: string;
    html_url: string;
    description: string | null;
}

interface IMinimalIssue {
    html_url: string;
    id: number;
    number: number;
    title: string;
    repository_url: string;
    pull_request?: any;
}

export class FormatUtil {
    public static formatIssueRoomName(issue: IMinimalIssue) {
        const orgRepoName = issue.repository_url.substr("https://api.github.com/repos/".length);
        return emoji.emojify(`${orgRepoName}#${issue.number}: ${issue.title}`);
    }

    public static formatRepoRoomName(repo: IMinimalRepository) {
        return emoji.emojify(repo.description ? `${repo.full_name}: ${repo.description}` : repo.full_name);
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

    public static getPartialBodyForIssue(repo: IMinimalRepository, issue: IMinimalIssue) {
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

    public static getPartialBodyForComment(comment: {id: number, html_url: string},
                                           repo?: IMinimalRepository,
                                           issue?: IMinimalIssue) {
        return {
            ...(issue && repo ? FormatUtil.getPartialBodyForIssue(repo, issue) : undefined),
            "external_url": comment.html_url,
            "uk.half-shot.matrix-github.comment": {
                id: comment.id,
            },
        };
    }

    public static projectListing(projects: ProjectsListResponseData): string {
        let f = '';
        for (const projectItem of projects) {
            f += ` - ${projectItem.name} (#${projectItem.number}) - Project ID: ${projectItem.id}`;
        }
        return f;
    }
}
