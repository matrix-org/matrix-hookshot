import { GetConnectionsResponseItem } from "../provisioning/api";

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

export enum WidgetConfigurationType {
    String,
    OAuthUrl,
}

export interface WidgetConfigurationOption {
    key: string;
    type: WidgetConfigurationType,
    currentValue: string|null;
    defaultValue?: string;
    additionalData?: Record<string, unknown>;
}

export interface WidgetConfigurationSection {
    name: string;
    options: WidgetConfigurationOption[];
}

export interface GetConnectionsForServiceResponse<T extends GetConnectionsResponseItem> {
    connections: T[];
    canEdit: boolean;
}
