import { EventEmitter } from "events";

type NotificationTypes = "github"|"gitlab";

export interface NotificationWatcherTask extends EventEmitter {
    userId: string;
    type: NotificationTypes;
    instanceUrl?: string;
    roomId: string;
    failureCount: number;
    start(intervalMs: number): void;
    stop(): void;
}