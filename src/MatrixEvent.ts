export interface MatrixEvent<T extends MatrixEventContent|unknown> {
    content: T;
    event_id: string;
    origin_server_ts: number;
    sender: string;
    state_key: string|undefined;
    type: string;
}

// tslint:disable-next-line: no-empty-interface
export interface MatrixEventContent {

}

export interface MatrixMemberContent extends MatrixEventContent {
    avatar_url: string|null;
    displayname: string|null;
    membership: "invite"|"join"|"knock"|"leave"|"ban";
    is_direct?: boolean;
    // Deliberately ignoring third_party_invite, unsigned
}

export interface MatrixMessageContent extends MatrixEventContent {
    body: string;
    formatted_body?: string;
    format?: string;
    msgtype: "m.text"|"m.notice"|"m.image"|"m.video"|"m.audio";
}
