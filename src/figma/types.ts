export interface FigmaPayload {
    comment_id: string,
    comment: [ { text: string, } ],
    created_at: string,
    event_type: string,
    file_key: string,
    file_name: string,
    mentions: unknown[],
    order_id: string,
    parent_id?: string,
    passcode: string,
    protocol_version: string,
    resolved_at: string,
    retries: number,
    timestamp: string,
    triggered_by: { id: string, handle: string },
    webhook_id: string,
}

export interface FigmaEvent {
    payload: FigmaPayload,
    instanceName: string,
}