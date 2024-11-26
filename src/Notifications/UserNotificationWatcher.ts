import { NotificationsDisableEvent, NotificationsEnableEvent } from "../Webhooks";
import { Logger } from "matrix-appservice-bridge";
import { createMessageQueue, MessageQueue, MessageQueueMessage } from "../MessageQueue";
import { MessageSenderClient } from "../MatrixSender";
import { NotificationWatcherTask } from "./NotificationWatcherTask";
import { GitHubWatcher } from "./GitHubWatcher";
import { GitHubUserNotification } from "../github/Types";
import { GitLabWatcher } from "./GitLabWatcher";
import { BridgeConfig, BridgePermissionLevel } from "../config/Config";
import Metrics from "../Metrics";
export interface UserNotificationsEvent {
    roomId: string;
    lastReadTs: number;
    events: GitHubUserNotification[];
}

const MIN_INTERVAL_MS = 15000;
const FAILURE_THRESHOLD = 50;

const log = new Logger("UserNotificationWatcher");

export class UserNotificationWatcher {
    /* Key: userId:type:instanceUrl */
    private userIntervals = new Map<string, NotificationWatcherTask>();
    private matrixMessageSender: MessageSenderClient;
    private queue: MessageQueue;

    constructor(private readonly config: BridgeConfig) {
        this.queue = createMessageQueue(config.queue);
        this.matrixMessageSender = new MessageSenderClient(this.queue);
    }

    private static constructMapKey(userId: string, type: "github"|"gitlab", instanceUrl?: string) {
        return `${userId}:${type}:${instanceUrl || ""}`;
    }

    public start() {
        this.queue.subscribe("notifications.user.*");
        this.queue.on("notifications.user.enable", (msg: MessageQueueMessage<NotificationsEnableEvent>) => {
            this.addUser(msg.data);
        });
        this.queue.on("notifications.user.disable", (msg: MessageQueueMessage<NotificationsDisableEvent>) => {
            this.removeUser(msg.data.userId, msg.data.type, msg.data.instanceUrl);
        });
    }

    public stop() {
        [...this.userIntervals.values()].forEach((v) => {
            v.stop();
        });
        this.queue.stop?.();
    }

    public removeUser(userId: string, type: "github"|"gitlab", instanceUrl?: string) {
        const key = UserNotificationWatcher.constructMapKey(userId, type, instanceUrl);
        const task = this.userIntervals.get(key);
        if (task) {
            task.stop();
            this.userIntervals.delete(key);
            log.info(`Removed ${key} from the notif queue`);
        }
        Metrics.notificationsWatchers.set({service: type}, this.userIntervals.size);
    }

    private onFetchFailure(task: NotificationWatcherTask) {
        if (task.failureCount > FAILURE_THRESHOLD) {
            this.removeUser(task.userId, task.type, task.instanceUrl);
            this.matrixMessageSender.sendMatrixText(
                task.roomId,
`The bridge has been unable to process your notification stream for some time, and has disabled notifications.
Check your token is still valid, and then turn notifications back on.`, "m.notice",
            );
        }
    }

    public addUser(data: NotificationsEnableEvent) {
        if (!this.config.checkPermission(data.userId, data.type, BridgePermissionLevel.notifications)) {
            throw Error('User does not have permission enable notifications');
        }
        let task: NotificationWatcherTask;
        const key = UserNotificationWatcher.constructMapKey(data.userId, data.type, data.instanceUrl);
        const existing = this.userIntervals.get(key);
        const since = data.since || existing?.since;
        if (since === undefined) {
            throw Error('`since` value missing from data payload, and no previous since value exists');
        }
        if (data.type === "github") {
            if (!this.config.github) {
                throw Error('GitHub is not configured');
            }
            task = new GitHubWatcher(data.token, this.config.github.baseUrl, data.userId, data.roomId, since, data.filterParticipating);
        } else if (data.type === "gitlab" && data.instanceUrl) {
            task = new GitLabWatcher(data.token, data.instanceUrl, data.userId, data.roomId, since);
        } else {
            throw Error('Notification type not known');
        }
        this.userIntervals.get(key)?.stop();
        task.start(MIN_INTERVAL_MS);
        task.on("fetch_failure", this.onFetchFailure.bind(this));
        task.on("new_events", (payload) => {
            this.queue.push<UserNotificationsEvent>(payload);
        });
        this.userIntervals.set(key, task);
        Metrics.notificationsWatchers.set({service: data.type}, this.userIntervals.size);
        log.info(`Inserted ${key} into the notif queue`);
    }
}
