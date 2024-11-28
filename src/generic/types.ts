import { WebhookResponse } from "../Connections";

export interface GenericWebhookEvent {
    hookData: unknown;
    hookId: string;
}

export type GenericWebhookEventResult = GenericWebhookEventResultSuccess | GenericWebhookEventResultFailure;

export interface GenericWebhookEventResultSuccess {
    successful: true|null;
    response?: WebhookResponse,
    notFound?: boolean;
}
export interface GenericWebhookEventResultFailure {
    successful: false;
    statusCode?: number;
    error?: string;
    notFound?: boolean;
}