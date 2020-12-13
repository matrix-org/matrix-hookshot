export interface BridgeRoomStateGitHub {
    enabled: boolean;
    tokenStored: boolean;
    identity: {
        name: string|null;
        avatarUrl: string|null;
    }|null;
    notifications: boolean;
}
export interface BridgeRoomState {
    title: string;
    github: BridgeRoomStateGitHub;
}