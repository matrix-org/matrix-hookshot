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
    author: {
        id: number;
        name: string;
        username: string;
        state: 'active';
        avatar_url: string;
        web_url: string;
    }
    web_url: string;
}