import { Octokit, RestEndpointMethodTypes } from "@octokit/rest";
import { EventEmitter } from "events";
import { GithubInstance } from "../github/GithubInstance";
import { GitHubUserNotification as HSGitHubUserNotification } from "../github/Types";
import { Logger } from "matrix-appservice-bridge";
import { NotificationWatcherTask } from "./NotificationWatcherTask";
import { RequestError } from "@octokit/request-error";
import Metrics from "../Metrics";
const log = new Logger("GitHubWatcher");

const GH_API_THRESHOLD = 50;
const GH_API_RETRY_IN = 1000 * 60;

type GitHubUserNotification = RestEndpointMethodTypes["activity"]["listNotificationsForAuthenticatedUser"]["response"];

export class GitHubWatcher extends EventEmitter implements NotificationWatcherTask  {
    private static apiFailureCount = 0;
    private static globalRetryIn = 0;

    public static checkGitHubStatus() {
        this.apiFailureCount = Math.min(this.apiFailureCount + 1, GH_API_THRESHOLD);
        if (this.apiFailureCount < GH_API_THRESHOLD) {
            log.warn(`API Failure count at ${this.apiFailureCount}`);
            return;
        }
        // The API is actively failing.
        if (this.globalRetryIn > 0) {
            this.globalRetryIn = Date.now() + GH_API_RETRY_IN;
        }
        log.warn(`API Failure limit reached, holding off new requests for ${GH_API_RETRY_IN / 1000}s`);
        Metrics.notificationsServiceUp.set({service: "github"}, 0);
    }

    private octoKit: Octokit;
    public failureCount = 0;
    private interval?: NodeJS.Timeout;
    public readonly type = "github";
    public readonly instanceUrl = undefined;

    constructor(token: string, baseUrl: URL, public userId: string, public roomId: string, private lastReadTs: number, private participating = false) {
        super();
        this.octoKit =  GithubInstance.createUserOctokit(token, baseUrl);
    }

    public get since() {
        return this.lastReadTs;
    }

    public start(intervalMs: number) {
        log.info(`Starting for ${this.userId}`);
        this.interval = setInterval(() => {
            this.getNotifications();
        }, intervalMs);
        this.getNotifications();
    }

    public stop() {
        if (this.interval) {
            log.info(`Stopping for ${this.userId}`);
            clearInterval(this.interval);
        }
    }

    private handleGitHubFailure(ex: RequestError) {
        log.error("An error occurred getting notifications:", ex);
        if (ex.status === 401 || ex.status === 404) {
            log.warn(`Got status ${ex.status} when handing user stream: ${ex.message}`);
            this.failureCount++;
        } else if (ex.status >= 500) {
            setImmediate(() => GitHubWatcher.checkGitHubStatus());
        }
        this.emit("fetch_failure", this);
    }

    private async getNotifications() {
        if (GitHubWatcher.globalRetryIn !== 0 && GitHubWatcher.globalRetryIn > Date.now()) {
            log.info(`Not getting notifications for ${this.userId}, API is still down.`);
            return;
        }
        log.debug(`Getting notifications for ${this.userId} ${this.lastReadTs}`);
        const since = this.lastReadTs !== 0 ? `&since=${new Date(this.lastReadTs).toISOString()}`: "";
        let response: GitHubUserNotification;
        try {
            response = await this.octoKit.activity.listNotificationsForAuthenticatedUser({since, participating: this.participating});
            Metrics.notificationsServiceUp.set({service: "github"}, 1);
            // We were succesful, clear any timeouts.
            GitHubWatcher.globalRetryIn = 0;
            // To avoid a bouncing issue, gradually reduce the failure count.
            GitHubWatcher.apiFailureCount = Math.max(0, GitHubWatcher.apiFailureCount - 2);
        } catch (ex) {
            await this.handleGitHubFailure(ex as RequestError);
            return;
        }
        this.lastReadTs = Date.now();

        if (response.data.length) {
            log.info(`Got ${response.data.length} notifications for ${this.userId}`);
        }
        for (const rawEvent of response.data) {
            const ev = rawEvent as unknown as HSGitHubUserNotification;
            try {
                if (rawEvent.subject.url) {
                    const res = await this.octoKit.request(rawEvent.subject.url);
                    ev.subject.url_data = res.data;
                }
                if (rawEvent.subject.latest_comment_url) {
                    const res = await this.octoKit.request(rawEvent.subject.latest_comment_url);
                    ev.subject.latest_comment_url_data = res.data;
                }
                if (rawEvent.reason === "review_requested") {
                    if (!ev.subject.url_data?.number) {
                        log.warn("review_requested was missing subject.url_data.number");
                        continue;
                    }
                    if (!rawEvent.repository.owner) {
                        log.warn("review_requested was missing repository.owner");
                        continue;
                    }
                    ev.subject.requested_reviewers = (await this.octoKit.pulls.listRequestedReviewers({
                        pull_number: ev.subject.url_data.number,
                        owner: rawEvent.repository.owner.login,
                        repo: rawEvent.repository.name,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    })).data as any; 
                    ev.subject.reviews = (await this.octoKit.pulls.listReviews({
                        pull_number: ev.subject.url_data.number,
                        owner: rawEvent.repository.owner.login,
                        repo: rawEvent.repository.name,
                    })).data;
                }
            } catch (ex) {
                log.warn(`Failed to pre-process ${rawEvent.id}: ${ex}`);
                // We still push
            }
            log.debug(`Pushing ${ev.id}`);
            Metrics.notificationsPush.inc({service: "github"});
            this.emit("new_events", {
                eventName: "notifications.user.events",
                data: {
                    roomId: this.roomId,
                    events: [ev],
                    lastReadTs: this.lastReadTs,
                },
                sender: "GithubWebhooks",
            });
        }
    }

}
