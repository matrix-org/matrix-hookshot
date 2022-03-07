export interface GenericWebhookEvent {
    hookData: unknown;
    hookId: string;
}

export interface GenericWebhookEventResult {
    successful?: boolean|null;
    notFound?: boolean;
}