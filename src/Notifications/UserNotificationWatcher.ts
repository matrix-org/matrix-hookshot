import { NotificationsEnableEvent } from "../GithubWebhooks";
import LogWrapper from "../LogWrapper";
import { MessageQueue } from "../MessageQueue/MessageQueue";
import { MessageSenderClient } from "../MatrixSender";
import { NotificationWatcherTask } from "./NotificationWatcherTask";
import { GitHubWatcher } from "./GitHubWatcher";
import { GitHubUserNotification } from "../Github/Types";
import { GitLabWatcher } from "./GitLabWatcher";

export interface UserNotificationsEvent {
    roomId: string;
    lastReadTs: number;
    events: GitHubUserNotification[];
}

const MIN_INTERVAL_MS = 15000;
const FAILURE_THRESHOLD = 50;

const log = new LogWrapper("UserNotificationWatcher");

export class UserNotificationWatcher {
    /* Key: userId:type:instanceUrl */
    private userIntervals = new Map<string, NotificationWatcherTask>();
    private matrixMessageSender: MessageSenderClient;

    constructor(private queue: MessageQueue) {
        this.matrixMessageSender = new MessageSenderClient(queue);
    }

    private static constructMapKey(userId: string, type: "github"|"gitlab", instanceUrl?: string) {
        return `${userId}:${type}:${instanceUrl || ""}`;
    }

    public start() {
        // No-op
    }

    public removeUser(userId: string, type: "github"|"gitlab", instanceUrl?: string) {
        const key = UserNotificationWatcher.constructMapKey(userId, type, instanceUrl);
        const task = this.userIntervals.get(key);
        if (task) {
            task.stop();
            this.userIntervals.delete(key);
            log.info(`Removed ${key} from the notif queue`);
        }
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
        let task: NotificationWatcherTask;
        const key = UserNotificationWatcher.constructMapKey(data.userId, data.type, data.instanceUrl);
        if (data.type === "github") {
            task = new GitHubWatcher(data.token, data.userId, data.roomId, data.since, data.filterParticipating);
        } else if (data.type === "gitlab" && data.instanceUrl) {
            task = new GitLabWatcher(data.token, data.instanceUrl, data.userId, data.roomId, data.since);
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
        log.info(`Inserted ${key} into the notif queue`);
    }
}
