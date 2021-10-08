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