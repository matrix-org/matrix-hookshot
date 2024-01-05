import { WebhookResponse } from "../Connections";

export interface GenericWebhookEvent {
    hookData: unknown;
    hookId: string;
}

export interface GenericWebhookEventResult {
    successful?: boolean|null;
    response?: WebhookResponse,
    notFound?: boolean;
}