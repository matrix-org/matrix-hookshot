/* eslint-disable camelcase */
import { ProjectsListResponseData } from './Github/Types';
import emoji from "node-emoji";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore 
import { JiraIssue } from './Jira/Types';
import { formatLabels, getPartialBodyForJiraIssue, hashId, getPartialBodyForGithubIssue, getPartialBodyForGithubRepo, MinimalGitHubRepo, MinimalGitHubIssue } from "./libRs";

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

export class FormatUtil {
    public static formatIssueRoomName(issue: MinimalGitHubIssue & {repository_url: string}) {
        const orgRepoName = issue.repository_url.slice("https://api.github.com/repos/".length);
        return emoji.emojify(`${orgRepoName}#${issue.number}: ${issue.title}`);
    }

    public static formatRepoRoomName(repo: MinimalGitHubRepo) {
        return emoji.emojify(repo.description ? `${repo.full_name}: ${repo.description}` : repo.full_name);
    }

    public static formatRoomTopic(repo: {state: string, html_url: string}) {
        return `Status: ${repo.state} | ${repo.html_url}`;
    }

    public static formatRepoRoomTeam(repo: {html_url: string}) {
        return `${repo.html_url}`;
    }

    public static getPartialBodyForGithubRepo(repo: MinimalGitHubRepo) {
        if (!repo.id || !repo.html_url || !repo.full_name) {
            throw Error('Missing keys in repo object');
        }
        return getPartialBodyForGithubRepo(repo);
    }

    public static getPartialBodyForGithubIssue(repo: MinimalGitHubRepo, issue: MinimalGitHubIssue) {
        if (!repo.id || !repo.html_url || !repo.full_name) {
            throw Error('Missing keys in repo object');
        }
        if (!issue.html_url || !issue.id || !issue.number || !issue.title) {
            throw Error('Missing keys in issue object');
        }
        return getPartialBodyForGithubIssue(repo, issue);
    }

    public static getPartialBodyForGitHubPR(repo: MinimalGitHubRepo, issue: IMinimalPR) {
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
                                           repo?: MinimalGitHubRepo,
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
