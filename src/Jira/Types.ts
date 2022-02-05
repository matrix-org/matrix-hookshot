
export interface JiraIssueType {
    self: string;
    id: string;
    description: string;
    iconUrl: string;
    name: string;
    subtask: boolean;
    avatarId: number;
    hierachyLevel: number;
}
export interface JiraProject {
    /**
     * URL
     */
    self: string;
    id: string;
    key: string;
    name: string;
    projectTypeKey: string;
    simplified: boolean;
    avatarUrls: Record<string, string>;
    issueTypes?: JiraIssueType[];
}

export interface JiraAccount {
    /**
     * URL
     */
    self: string;
    accountId: string;
    avatarUrls: Record<string, string>;
    displayName: string;
    active: true;
    timeZone: string;
    accountType: "atlassian";
}

export interface JiraComment {
    /**
     * URL
     */
    self: string;
    id: string;
    author: JiraAccount;
    body: string;
    updateAuthor: JiraAccount;
    created: string;
    updated: string;
    jsdPublic: boolean;
}

export interface JiraIssue {
    /**
     * URL
     */
    self: string;
    id: string;
    key: string;
    fields: {
        summary: string;
        issuetype: unknown;
        project: JiraProject;
        assignee: null|unknown;
        priority: unknown;
        status: unknown;
        creator?: JiraAccount;
    }
}

export interface JiraStoredToken {
    expires_in: number;
    access_token: string;
    refresh_token?: string;
    instance: string;
}

export interface JiraOAuthResult {
    state?: string;
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope: string;
}

export interface JiraAPIAccessibleResource {
    id: string;
    url: string,
    name: string,
    scopes: string[],
    avatarUrl: string,
}