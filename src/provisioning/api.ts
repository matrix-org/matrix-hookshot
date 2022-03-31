export interface GetConnectionTypeResponseItem {
    eventType: string;
    type: string;
    service: string;
    botUserId: string;
}

export interface GetConnectionsResponseItem extends GetConnectionTypeResponseItem {
    id: string;
    config: Record<string, unknown>;
}