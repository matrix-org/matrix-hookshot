/* eslint-disable camelcase */

export interface IGitLabWebhookEvent {
    object_kind: string;
    event_type: string;    
    object_attributes: {
        action: string;
        state: string;
    }
}

export interface IGitlabUser {
    name: string;
    username: string;
    avatar_url: string;
    email: string;
}
export interface IGitlabRepository {
    name: string;
    homepage: string;
    url: string;
    description: string;
}


export interface IGitlabProject {
    path_with_namespace: string;
    web_url: string;
    homepage: string;
}

export interface IGitlabIssue {
    iid: number;
    description: string;
}

export interface IGitlabMergeRequest {
    url: string;
    title: string;
    iid: number;
    author_id: number;
    state: 'opened'|'closed'|'merged';

}

export interface IGitLabMergeRequestObjectAttributes extends IGitlabMergeRequest {
    action: "open"|"close"|"reopen"|"approved"|"unapproved"|"merge";
}

export interface IGitLabLabel {
    id: number;
    title: string;
    color: string;
    project_id: number;
    created_at: string;
    updated_at: string;
    template: boolean;
    description: string;
    type: "ProjectLabel"|"GroupLabel";
    group_id: number;
}

export interface IGitLabWebhookMREvent {
    object_kind: "merge_request";
    user: IGitlabUser;
    project: IGitlabProject;
    repository: IGitlabRepository;
    object_attributes: IGitLabMergeRequestObjectAttributes;
    labels: IGitLabLabel[];
}

export interface IGitLabWebhookTagPushEvent {
    object_kind: "tag_push";
    user_id: number;
    ref: string;
    user_name: string;
    /**
     * Commit hash before push
     */
    before: string;
    /**
     * Commit hash after push
     */
    after: string;
    project: IGitlabProject;
    repository: IGitlabRepository;
}

export interface IGitLabWebhookWikiPageEvent {
    object_kind: "wiki_page";
    user: IGitlabUser;
    project: IGitlabProject;
    wiki: {
        web_url: string;
        path_with_namespace: string;
    };
    object_attributes: {
        title: string;
        url: string;
        message: string;
        format: "markdown";
        content: string;
        action: "create"|"update"|"delete";
    };
}

export interface IGitLabWebhookNoteEvent {
    user: IGitlabUser;
    project: IGitlabProject;
    issue: IGitlabIssue;
    repository: {
        name: string;
        url: string;
        description: string;
        homepage: string;
    };
    object_attributes: {
        id: number;
        noteable_id: number;
        description: string;
    }
}
export interface IGitLabWebhookIssueStateEvent {
    user: IGitlabUser;
    project: IGitlabProject;
    repository: {
        name: string;
        url: string;
        description: string;
        homepage: string;
    };
    object_attributes: {
        id: number;
        iid: number;
        description: string;
    }
}
