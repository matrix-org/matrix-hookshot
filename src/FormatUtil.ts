import { ProjectsListResponseData } from "./github/Types";
import { emojify } from "node-emoji";
import markdown from "markdown-it";
import { JiraIssue } from "./jira/Types";
import {
  formatLabels,
  getPartialBodyForJiraIssue,
  hashId,
  getPartialBodyForGithubIssue,
  getPartialBodyForGithubRepo,
  MinimalGitHubIssue,
} from "./libRs";

const md = new markdown();

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
  color?: string;
  name: string;
  description?: string;
}

export type LooseMinimalGitHubRepo = {
  id: number;
  full_name: string;
  html_url: string;
  description?: string | null;
};

export class FormatUtil {
  public static formatIssueRoomName(
    issue: MinimalGitHubIssue,
    repository: { full_name: string },
  ) {
    return emojify(`${repository.full_name}#${issue.number}: ${issue.title}`);
  }

  public static formatRepoRoomName(repo: LooseMinimalGitHubRepo) {
    return emojify(
      repo.description
        ? `${repo.full_name}: ${repo.description}`
        : repo.full_name,
    );
  }

  public static formatRoomTopic(repo: { state: string; html_url: string }) {
    return `Status: ${repo.state} | ${repo.html_url}`;
  }

  public static formatRepoRoomTeam(repo: { html_url: string }) {
    return `${repo.html_url}`;
  }

  public static formatPushEventContent({
    contributors,
    commits,
    branchName,
    branchUrl,
    commitsUrl,
    repoName,
    maxCommits = 5,
    shouldName = false,
    template = "md_bullets",
    showCommitBody = false,
  }: {
      contributors: string[];
      commits: {
        id: string;
        url: string;
        message: string;
        author: { name: string };
      }[];
      branchName: string;
      branchUrl: string;
      commitsUrl: string;
      repoName: string;
      maxCommits?: number;
      shouldName?: boolean;
      template?: "md_bullets" | "html_dropdown";
      showCommitBody?: boolean;
  }) {
      const tooManyCommits = commits.length > maxCommits;
      const displayedCommits = Math.min(commits.length, maxCommits);
      const separator = template === "md_bullets" ? "\n" : "<br>";
      const multipleContributors = contributors.length > 1;

      const formatCommitMessage = ({
        commit,
        showAuthor,
      }: {
        commit: typeof commits[0];
        showAuthor: boolean;
      }) => {
        const { id, url, message, author } = commit;
        const [title, ...body] = message.split("\n");
        const authorInfo =
            shouldName && showAuthor ? ` by \`${author.name}\`` : "";
        const formattedBody =
            showCommitBody && body.length
                ? `${separator}${body.join(separator)}`
                : "";
        const commitId = id.slice(0, 8);

        return template === "md_bullets"
            ? `[\`${commitId}\`](${url}) ${title}${authorInfo}${formattedBody}`
            : `<a href="${url}"><code>${commitId}</code></a> ${title}${authorInfo}${formattedBody}`;
      };

      if (template === "html_dropdown") {
        if (commits.length === 1) {
          const singleCommitMessage = formatCommitMessage({
            commit: commits[0],
            showAuthor: false,
          });

          return {
            body: [
              `**${contributors.join(", ")}** pushed [1 commit](${commitsUrl}) to [\`${branchName}\`](${branchUrl}) for ${repoName}: `,
              "\n\n",
              singleCommitMessage,
            ].join(""),
            formatted_body: `<b>${contributors.join(
              ", "
            )}</b> pushed <a href="${commitsUrl}">1 commit</a> to <a href="${branchUrl}"><code>${branchName}</code></a>
            for ${repoName}: <br><br> ${singleCommitMessage}`,
            format: "org.matrix.custom.html",
          };
        }

        const commitList = commits
          .slice(0, displayedCommits)
          .map((commit) =>
            formatCommitMessage({
              commit,
              showAuthor: multipleContributors,
            })
          )
          .join("<hr>");

        const extraCommits = tooManyCommits
          ? `<br><br><a href="${commitsUrl}">and ${commits.length - displayedCommits} more commits</a>`
          : "";

        return {
          body: `**${contributors.join(", ")}** pushed [${commits.length} commit${
            commits.length === 1 ? "" : "s"
          }](${commitsUrl}) to [\`${branchName}\`](${branchUrl}) for ${repoName}`,
          formatted_body: `
            <details>
              <summary><b>${contributors.join(", ")}</b> pushed
              <a href="${commitsUrl}">${commits.length} commit${
            commits.length === 1 ? "" : "s"
          }</a> to <a href="${branchUrl}"><code>${branchName}</code></a> for ${repoName}
              </summary>
              <br>${commitList}${extraCommits}
            </details>
          `,
          format: "org.matrix.custom.html",
        };
      }

      const commitMessages = commits
        .slice(0, displayedCommits)
        .map((commit) =>
          formatCommitMessage({ commit, showAuthor: multipleContributors })
        )
        .join("\n - ");

      let content = `**${contributors.join(", ")}** pushed [${commits.length} commit${
        commits.length === 1 ? "" : "s"
      }](${commitsUrl}) to [\`${branchName}\`](${branchUrl}) for ${repoName}`;

      if (displayedCommits === 1) {
        const onlyTitle = commits[0].message.split("\n").length === 1;
        content += `: \n\n ${formatCommitMessage({
          commit: commits[0],
          showAuthor: false,
        })}`;
      } else if (displayedCommits > 1) {
        content += `\n - ${commitMessages}\n`;
      }

      if (tooManyCommits) {
        content += `\nand [${commits.length - displayedCommits} more](${commitsUrl}) commits`;
      }

      return {
        body: content,
        formatted_body: md.render(content),
      };
  }

  public static getPartialBodyForGithubRepo(repo: LooseMinimalGitHubRepo) {
    if (!repo.id || !repo.html_url || !repo.full_name) {
      throw Error("Missing keys in repo object");
    }
    return getPartialBodyForGithubRepo({
      ...repo,
      description: repo.description ?? undefined,
    });
  }

  public static getPartialBodyForGithubIssue(
    repo: LooseMinimalGitHubRepo,
    issue: MinimalGitHubIssue,
  ) {
    if (!repo.id || !repo.html_url || !repo.full_name) {
      throw Error("Missing keys in repo object");
    }
    if (!issue.html_url || !issue.id || !issue.number || !issue.title) {
      throw Error("Missing keys in issue object");
    }
    return getPartialBodyForGithubIssue(
      {
        ...repo,
        description: repo.description ?? undefined,
      },
      issue,
    );
  }

  public static getPartialBodyForGitHubPR(
    repo: LooseMinimalGitHubRepo,
    issue: IMinimalPR,
  ) {
    return {
      ...FormatUtil.getPartialBodyForGithubRepo(repo),
      external_url: issue.html_url,
      "uk.half-shot.matrix-hookshot.github.pull_request": {
        id: issue.id,
        number: issue.number,
        title: issue.title,
        url: issue.html_url,
      },
    };
  }

  public static getPartialBodyForComment(
    comment: { id: number; html_url: string },
    repo?: LooseMinimalGitHubRepo,
    issue?: MinimalGitHubIssue,
  ) {
    return {
      ...(issue && repo
        ? FormatUtil.getPartialBodyForGithubIssue(repo, issue)
        : undefined),
      external_url: comment.html_url,
      "uk.half-shot.matrix-hookshot.github.comment": {
        id: comment.id,
      },
    };
  }

  public static projectListing(projects: ProjectsListResponseData): string {
    let f = "";
    for (const projectItem of projects) {
      f += ` - ${projectItem.name} (#${projectItem.number}) - Project ID: ${projectItem.id}`;
    }
    return f;
  }

  public static formatLabels(labels: ILabel[] = []): {
    plain: string;
    html: string;
  } {
    return formatLabels(labels);
  }

  public static getPartialBodyForJiraIssue(issue: JiraIssue) {
    return getPartialBodyForJiraIssue(issue);
  }

  public static hashId(id: string) {
    return hashId(id);
  }
}
