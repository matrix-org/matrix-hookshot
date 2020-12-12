export interface BridgeRoomState {
    title: string;
    github: {
        enabled: boolean;
        tokenStored: boolean;
        identity: {
            name: string|null;
            avatarUrl: string|null;
        }|null;
    }
}