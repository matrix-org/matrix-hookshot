import { Endpoints } from "@octokit/types";

export type IssuesGetResponseData = Endpoints["GET /repos/{owner}/{repo}/issues/{issue_number}"]["response"]["data"];
export type IssuesGetCommentResponseData = Endpoints["GET /repos/{owner}/{repo}/issues/comments/{comment_id}"]["response"]["data"];
export type PullsListReviewsResponseData = Endpoints["GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews"]["response"]["data"];
export type PullsListRequestedReviewersResponseData = Endpoints["GET /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers"]["response"]["data"];
export type ReposGetResponseData = Endpoints["GET /repos/{owner}/{repo}"]["response"]["data"];
export type ProjectsGetResponseData = Endpoints["GET /projects/{project_id}"]["response"]["data"];
export type ProjectsListForTeamsResponseData = Endpoints["GET /teams/{team_id}/projects"]["response"]["data"];
export type ProjectsListForRepoResponseData = Endpoints["GET /repos/{owner}/{repo}/projects"]["response"]["data"];
export type ProjectsListForUserResponseData = Endpoints["GET /users/{username}/projects"]["response"]["data"];
export type ProjectsListResponseData = ProjectsListForTeamsResponseData|ProjectsListForRepoResponseData|ProjectsListForUserResponseData;
export type IssuesListAssigneesResponseData = Endpoints["GET /repos/{owner}/{repo}/issues"]["response"]["data"];
export type PullsGetResponseData = Endpoints["GET /repos/{owner}/{repo}/pulls"]["response"]["data"];
export type PullGetResponseData = Endpoints["GET /repos/{owner}/{repo}/pulls/{pull_number}"]["response"]["data"];
export type DiscussionDataType = Endpoints["GET /repos/{owner}/{repo}/pulls/{pull_number}"]["response"]["data"];
export type InstallationDataType = Endpoints["GET /app/installations/{installation_id}"]["response"]["data"];
export type CreateInstallationAccessTokenDataType = Endpoints["POST /app/installations/{installation_id}/access_tokens"]["response"]["data"];

export const NAMELESS_ORG_PLACEHOLDER = "No name";

export interface GitHubUserNotification {
    id: string;
    reason: "assign"|"author"|"comment"|"invitation"|"manual"|"mention"|"review_requested"|
            "security_alert"|"state_change"|"subscribed"|"team_mention";
    unread: boolean;
    updated_at: number;
    last_read_at: number;
    url: string;
    subject: {
        title: string;
        url: string;
        latest_comment_url: string|null;
        type: "PullRequest"|"Issue"|"RepositoryVulnerabilityAlert";
        // Probably.
        url_data?: IssuesGetResponseData;
        latest_comment_url_data?: IssuesGetCommentResponseData;
        requested_reviewers?: PullsListRequestedReviewersResponseData;
        reviews?: PullsListReviewsResponseData;
    };
    // Not quite the right type but good nuff.
    repository: ReposGetResponseData;
}

export interface GitHubOAuthTokenResponse {
    state: string;
    access_token: string;
    expires_in?: string;
    refresh_token?: string;
    refresh_token_expires_in?: string;
    scope: string;
    token_type: 'bearer'|'pat';
}

export interface GitHubOAuthErrorResponse {
    error: string;
    error_description: string;
    error_uri: string;
}

export interface GitHubOAuthToken {
    access_token: string;
    expires_in?: number;
    refresh_token?: string;
    refresh_token_expires_in?: number;
    scope?: string;
    token_type: 'bearer'|'pat';
}
