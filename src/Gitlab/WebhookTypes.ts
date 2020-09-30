
export interface IGitLabWebhookEvent {
    object_kind: string;
    event_type: string;    
    object_attributes: {
        action: string;
        state: string;
    }
}

export interface IGitLabWebhookMREvent {
    object_kind: "merge_request";
    user: {
        name: string;
        username: string;
        avatar_url: string;
    };
    project: {
        namespace: string;
    };
}