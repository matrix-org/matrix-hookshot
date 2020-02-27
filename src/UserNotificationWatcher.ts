import { NotificationsEnableEvent } from "./GithubWebhooks";
import { Octokit } from "@octokit/rest";
import { createTokenAuth } from "@octokit/auth-token";
import { LogWrapper } from "./LogWrapper";
import { MessageQueue } from "./MessageQueue/MessageQueue";
import { MessageSenderClient } from "./MatrixSender";

interface UserStream {
    octoKit: Octokit;
    userId: string;
    roomId: string;
    lastReadTs: number;
    participating: boolean;
    failureCount: number;
}

export interface UserNotificationsEvent {
    roomId: string;
    lastReadTs: number;
    events: UserNotification[];
}

export interface UserNotification {
    id: string;
    reason: "assign"|"author"|"comment"|"invitation"|"manual"|"mention"|"review_required"|"review_requested"|
            "security_alert"|"state_change"|"subscribed"|"team_mention";
    unread: boolean;
    updated_at: number;
    last_read_at: number;
    url: string;
    subject: {
        title: string;
        url: string;
        latest_comment_url: string|null;
        type: "PullRequest"|"Issue"|"RepositoryVulnerabilityAlert";
        // Probably.
        url_data?: Octokit.IssuesGetResponse;
        latest_comment_url_data?: Octokit.IssuesGetCommentResponse;
    };
    repository: Octokit.ActivityGetThreadResponseRepository;
}

const MIN_INTERVAL_MS = 15000;
const FAILURE_THRESHOLD = 50;

const log = new LogWrapper("UserNotificationWatcher");

export class UserNotificationWatcher {
    private userIntervals: Map<string, NodeJS.Timeout> = new Map();
    private matrixMessageSender: MessageSenderClient;

    constructor(private queue: MessageQueue) {
        this.matrixMessageSender = new MessageSenderClient(queue);
    }

    public start() {
        // No-op
    }

    public async fetchUserNotifications(stream: UserStream) {
        log.info(`Getting notifications for ${stream.userId} ${stream.lastReadTs}`);
        try {
            const since = stream.lastReadTs !== 0 ? `&since=${new Date(stream.lastReadTs).toISOString()}`: "";
            const response = await stream.octoKit.request(
                `/notifications?participating=${stream.participating}${since}`,
            );
            log.info(`Got ${response.data.length} notifications`);
            stream.lastReadTs = Date.now();
            const events: UserNotification[] = [];

            for (const rawEvent of response.data as UserNotification[]) {
                try {
                    await (async () => {
                        if (rawEvent.subject.url) {
                            const res = await stream.octoKit.request(rawEvent.subject.url);
                            rawEvent.subject.url_data = res.data;
                        }
                        if (rawEvent.subject.latest_comment_url) {
                            const res = await stream.octoKit.request(rawEvent.subject.latest_comment_url);
                            rawEvent.subject.latest_comment_url_data = res.data;
                        }
                        events.push(rawEvent);
                    })();
                } catch (ex) {
                    log.warn(`Failed to pre-process ${rawEvent.id}: ${ex}`);
                    // If it fails, we can just push the raw thing.
                    events.push(rawEvent);
                }
            }

            if (events.length > 0) {
                await this.queue.push<UserNotificationsEvent>({
                    eventName: "notifications.user.events",
                    data: {
                        roomId: stream.roomId,
                        events,
                        lastReadTs: stream.lastReadTs,
                    },
                    sender: "GithubWebhooks",
                });
            }

        } catch (ex) {
            stream.failureCount++;
            log.error("An error occured getting notifications:", ex);
        }

        if (stream.failureCount > FAILURE_THRESHOLD) {
            this.removeUser(stream.userId);
            await this.matrixMessageSender.sendMatrixText(
                stream.roomId,
`The bridge has been unable to process your notification stream for some time, and has disabled notifications.
Check your GitHub token is still valid, and then turn notifications back on.`, "m.notice",
            );
        }
        return stream;
    }

    public removeUser(userId: string) {
        const timer = this.userIntervals.get(userId);
        if (timer) {
            clearInterval(timer);
            log.info(`Removed ${userId} to notif queue`);
        }
    }

    public addUser(data: NotificationsEnableEvent) {
        const clientKit = new Octokit({
            authStrategy: createTokenAuth,
            auth: data.token,
            userAgent: "matrix-github v0.0.1",
        });

        const userId = data.user_id;
        this.removeUser(userId);

        let stream: UserStream = {
            octoKit: clientKit,
            userId,
            roomId: data.room_id,
            lastReadTs: data.since,
            participating: data.filter_participating,
            failureCount: 0,
        };

        log.info(`Inserted ${userId} into the notif queue`);
        const interval = setInterval(async () => {
            stream = await this.fetchUserNotifications(stream);
        }, MIN_INTERVAL_MS);
        this.userIntervals.set(userId, interval);
        return;
    }
}
