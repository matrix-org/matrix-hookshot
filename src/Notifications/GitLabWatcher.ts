import { EventEmitter } from "events";
import { GitLabClient } from "../Gitlab/Client";
import { Logger } from "matrix-appservice-bridge";
import { NotificationWatcherTask } from "./NotificationWatcherTask";

const log = new Logger("GitLabWatcher");

export class GitLabWatcher extends EventEmitter implements NotificationWatcherTask  {
    private client: GitLabClient;
    private interval?: NodeJS.Timeout;
    public readonly type = "gitlab";
    public failureCount = 0;
    constructor(token: string, url: string, public userId: string, public roomId: string, public since: number) {
        super();
        this.client = new GitLabClient(url, token);
    }

    public start(intervalMs: number) {
        this.interval = setInterval(() => {
            this.getNotifications();
        }, intervalMs);
    }

    public stop() {
        if (this.interval) {
            clearInterval(this.interval);
        }
    }

    private async getNotifications() {
        log.info(`Fetching events from GitLab for ${this.userId}`);
    }
}