export interface GitLabAuthor {
    id: number;
    name: string;
    username: string;
    state: 'active';
    avatar_url: string;
    web_url: string;
}

// https://docs.gitlab.com/ee/api/access_requests.html#valid-access-levels
export enum AccessLevel {
    NoAccess = 0,
    MinimalAccess = 5,
    Guest = 10,
    Reporter = 20,
    Developer = 30,
    Maintainer = 40,
    // Only valid to set for groups 
    Owner = 50,
}

export interface GetUserResponse {
    id: number;
    username: string;
    email: string;
    name: string;
    state: string;
    avatar_url: string;
    web_url: string;
    created_at: string;
    bio: string;
    bio_html: string;
    location: null|string;
    public_email: string;
    skype: string;
    linkedin: string;
    twitter: string;
    website_url: string;
    organization: string;
    last_sign_in_at: string;
    confirmed_at: string;
    theme_id: number;
    last_activity_on: string;
    color_scheme_id: number;
    projects_limit: number;
    current_sign_in_at: string;
    identities: [
        {provider: string, extern_uid: string},
    ];
    can_create_group: boolean;
    can_create_project: boolean;
    two_factor_enabled: boolean;
    external: boolean;
    private_profile: boolean;
}

// hhttps://docs.gitlab.com/ee/api/issues.html#single-project-issue
export interface GetIssueOpts {
    projects: string[];
    issue: number;
}

// https://docs.gitlab.com/ee/api/issues.html#new-issue
export interface CreateIssueOpts {
    id: string|number;
    title: string;
    description?: string;
    confidential?: boolean;
    labels?: string[];
}

export interface CreateIssueResponse {
    state: string;
    id: string;
    iid: string;
    web_url: string;
}

// https://docs.gitlab.com/ee/api/issues.html#new-issue
export interface EditIssueOpts {
    id: string|number;
    issue_iid: string|number;
    title?: string;
    description?: string;
    confidential?: boolean;
    labels?: string[];
    state_event?: string;
}

export interface CreateIssueResponse {
    state: string;
    id: string;
    web_url: string;
}

export interface GetIssueResponse {
    id: number;
    iid: number;
    title: string;
    description: string;
    state: 'opened'|'closed';
    author: GitLabAuthor;
    references: {
        short: string;
        relative: string;
        full: string;
    }
    web_url: string;
}

export interface GetTodosResponse {
    id: number;
    author: GitLabAuthor;
    action_name: string;
    project: {
        id: number;
        name: string;
        name_with_namespace: string;
        path: string;
        path_with_namespace: string;
    };
    target: {
        title: string;
        description: string;
        state: 'opened'|'closed';
        assignee: {
            name: string;
            username: string;
            id: 1;
            state: "active";
            avatar_url: string;
            web_url: string;
        }
    }
    target_url: string;
    body: string;
    created_at: string;
    updated_at: string;
}

export interface EventsOpts {
    after: Date;
}

export interface CreateIssueNoteOpts {
    body: string;
    confidential?: boolean;
}

export interface CreateIssueNoteResponse {
    id: number;
    type: string|null;
    body: string;
    attachment: null;
    author: GitLabAuthor;
    created_at: string;
    updated_at: string;
    system: boolean;
    noteable_id: number;
    noteable_type: 'Issue';
    resolvable: boolean;
    confidential: boolean;
    noteable_iid: string;
    commands_changes: unknown;
}
  
export interface GetProjectResponse {
    id: number;
    name: string;
    path_with_namespace: string;
    title: string;
    description: string;
    visibility: "private"|"internal"|"public",
    state: 'opened'|'closed';
    owner: {
        id: number;
        name: string;
    };
    permissions: {
        project_access?: {
          access_level: AccessLevel;
        },
        group_access?: {
          access_level: AccessLevel;
        }
    };
    author: GitLabAuthor;
    references: {
        short: string;
        relative: string;
        full: string;
    }
    web_url: string;
}

export interface ProjectHookOpts {
    url: string;
    token: string;
    push_events?: true;
    push_events_branch_filter?: string;
    issues_events?: boolean;
    confidential_issues_events?: boolean;
    merge_requests_events?: boolean;
    tag_push_events?: boolean;
    note_events?: boolean;
    confidential_note_events?: boolean;
    job_events?: boolean;
    pipeline_events?: boolean;
    wiki_page_events?: boolean;
    deployment_events?: boolean;
    releases_events?: boolean;
    enable_ssl_verification?: boolean;
}

export interface ProjectHook extends ProjectHookOpts {
    id: number;
    token: never;
    project_id: 3;
    created_at?: string;
}

/** newest last, to enable feeding it straight into an LRU cache */
export type SerializedGitlabDiscussionThreads = { discussionId: string, eventId: string }[];

export interface SimpleProject {
    avatar_url?: string;
    description?: string;
    id: string;
    name: string;
    path: string;
    path_with_namespace: string;
}