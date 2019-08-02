export const BRIDGE_STATE_TYPE = "uk.half-shot.matrix-github.bridge";

export interface IBridgeRoomState {
    state_key: string;
    content: {
        org: string;
        repo: string;
        state: string;
        issues: string[];
        comments_processed: number,
    },
}