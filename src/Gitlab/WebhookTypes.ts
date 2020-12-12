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

export interface IGitlabProject {
    path_with_namespace: string;
    web_url: string;
}

export interface IGitlabIssue {
    iid: number;
    description: string;
}


export interface IGitLabWebhookMREvent {
    object_kind: "merge_request";
    user: IGitlabUser;
    project: IGitlabProject;
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