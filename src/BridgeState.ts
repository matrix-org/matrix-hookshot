import { MatrixEvent } from "./MatrixEvent";

export const BRIDGE_STATE_TYPE = "uk.half-shot.matrix-github.bridge";

interface BridgeRoomStateContent {
    org: string;
    repo: string;
    state: string;
    issues: string[];
    comments_processed: number;
}

export interface IBridgeRoomState extends MatrixEvent<BridgeRoomStateContent> {
    state_key: string;
}
