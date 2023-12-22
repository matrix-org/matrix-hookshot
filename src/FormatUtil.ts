import { ProjectsListResponseData } from './github/Types';
import { emojify } from "node-emoji";
import { JiraIssue } from './jira/Types';
import { formatLabels, getPartialBodyForJiraIssue, hashId, getPartialBodyForGithubIssue, getPartialBodyForGithubRepo, MinimalGitHubIssue } from "./libRs";

interface IMinimalPR {
    html_url: string;
    id: number;
    number: number;
    title: string;
    user: {
        login: string;
    };
}


export interface ILabel {
    color?: string,
    name: string,
    description?: string
}

export type LooseMinimalGitHubRepo = {
    id: number,
    full_name: string,
    html_url: string,
    description?: string|null,
  }

export class FormatUtil {
    public static formatIssueRoomName(issue: MinimalGitHubIssue, repository: { full_name: string}) {
        return emojify(`${repository.full_name}#${issue.number}: ${issue.title}`);
    }

    public static formatRepoRoomName(repo: LooseMinimalGitHubRepo) {
        return emojify(repo.description ? `${repo.full_name}: ${repo.description}` : repo.full_name);
    }

    public static formatRoomTopic(repo: {state: string, html_url: string}) {
        return `Status: ${repo.state} | ${repo.html_url}`;
    }

    public static formatRepoRoomTeam(repo: {html_url: string}) {
        return `${repo.html_url}`;
    }

    public static getPartialBodyForGithubRepo(repo: LooseMinimalGitHubRepo) {
        if (!repo.id || !repo.html_url || !repo.full_name) {
            throw Error('Missing keys in repo object');
        }
        return getPartialBodyForGithubRepo({
            ...repo,
            description: repo.description ?? undefined,
        });
    }

    public static getPartialBodyForGithubIssue(repo: LooseMinimalGitHubRepo, issue: MinimalGitHubIssue) {
        if (!repo.id || !repo.html_url || !repo.full_name) {
            throw Error('Missing keys in repo object');
        }
        if (!issue.html_url || !issue.id || !issue.number || !issue.title) {
            throw Error('Missing keys in issue object');
        }
        return getPartialBodyForGithubIssue({
            ...repo,
            description: repo.description ?? undefined,
        }, issue);
    }

    public static getPartialBodyForGitHubPR(repo: LooseMinimalGitHubRepo, issue: IMinimalPR) {
        return {
            ...FormatUtil.getPartialBodyForGithubRepo(repo),
            "external_url": issue.html_url,
            "uk.half-shot.matrix-hookshot.github.pull_request": {
                id: issue.id,
                number: issue.number,
                title: issue.title,
                url: issue.html_url,
            },
        };
    }


    public static getPartialBodyForComment(comment: {id: number, html_url: string},
                                           repo?: LooseMinimalGitHubRepo,
                                           issue?: MinimalGitHubIssue) {
        return {
            ...(issue && repo ? FormatUtil.getPartialBodyForGithubIssue(repo, issue) : undefined),
            "external_url": comment.html_url,
            "uk.half-shot.matrix-hookshot.github.comment": {
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

    public static formatLabels(labels: ILabel[] = []): { plain: string, html: string } {
        return formatLabels(labels);
    }

    public static getPartialBodyForJiraIssue(issue: JiraIssue) {
        return getPartialBodyForJiraIssue(issue);
    }

    public static hashId(id: string) {
        return hashId(id);
    }
}
