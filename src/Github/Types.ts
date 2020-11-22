import { IssuesGetResponseData, IssuesGetCommentResponseData, PullsListReviewsResponseData, ReposGetResponseData, PullsListRequestedReviewersResponseData } from "@octokit/types";

/* eslint-disable camelcase */
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
