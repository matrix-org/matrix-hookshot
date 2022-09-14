export interface GenericWebhookEvent {
    hookData: unknown;
    hookId: string;
    userAgent?: string;
    contentType?: string;
}

export interface GenericWebhookEventResult {
    successful?: boolean|null;
    notFound?: boolean;
}