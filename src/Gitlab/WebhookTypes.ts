/* eslint-disable camelcase */

export interface IGitLabWebhookEvent {
    object_kind: string;
    event_type: string;    
    object_attributes: {
        action: string;
        state: string;
    }
}

interface IGitlabUser {
    name: string;
    username: string;
    avatar_url: string;
    email: string;
}

interface IGitlabProject {
    path_with_namespace: string;
    web_url: string;
}

interface IGitlabIssue {
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
}