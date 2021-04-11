import { Octokit } from "@octokit/rest";
import { EventEmitter } from "events";
import { GithubInstance } from "../Github/GithubInstance";
import LogWrapper from "../LogWrapper";
import { NotificationWatcherTask } from "./NotificationWatcherTask";
import { RequestError } from "@octokit/request-error";
import { GitHubUserNotification } from "../Github/Types";
import { OctokitResponse } from "@octokit/types";

const log = new LogWrapper("GitHubWatcher");

const GH_API_THRESHOLD = 50;
const GH_API_RETRY_IN = 1000 * 60;

export class GitHubWatcher extends EventEmitter implements NotificationWatcherTask  {
    private static apiFailureCount: number;
    private static globalRetryIn: number;

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
    }

    private octoKit: Octokit;
    public failureCount = 0;
    private interval?: NodeJS.Timeout;
    private lastReadTs = 0;
    public readonly type = "github";
    public readonly instanceUrl = undefined;

    constructor(token: string, public userId: string, public roomId: string, since: number, private participating = false) {
        super();
        this.octoKit =  GithubInstance.createUserOctokit(token);
        this.lastReadTs = since;
    }

    public start(intervalMs: number) {
        log.info(`Starting for ${this.userId}`);
        this.interval = setTimeout(() => {
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
        log.error("An error occured getting notifications:", ex);
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
        log.info(`Getting notifications for ${this.userId} ${this.lastReadTs}`);
        const since = this.lastReadTs !== 0 ? `&since=${new Date(this.lastReadTs).toISOString()}`: "";
        let response: OctokitResponse<GitHubUserNotification[]>;
        try {
            response = await this.octoKit.request(
                `/notifications?participating=${this.participating}${since}`,
            );
            // We were succesful, clear any timeouts.
            GitHubWatcher.globalRetryIn = 0;
            // To avoid a bouncing issue, gradually reduce the failure count.
            GitHubWatcher.apiFailureCount = Math.max(0, GitHubWatcher.apiFailureCount - 2);
        } catch (ex) {
            await this.handleGitHubFailure(ex);
            return;
        }
        log.info(`Got ${response.data.length} notifications`);
        this.lastReadTs = Date.now();

        for (const rawEvent of response.data) {
            try {
                if (rawEvent.subject.url) {
                    const res = await this.octoKit.request(rawEvent.subject.url);
                    rawEvent.subject.url_data = res.data;
                }
                if (rawEvent.subject.latest_comment_url) {
                    const res = await this.octoKit.request(rawEvent.subject.latest_comment_url);
                    rawEvent.subject.latest_comment_url_data = res.data;
                }
                if (rawEvent.reason === "review_requested") {
                    if (!rawEvent.subject.url_data?.number) {
                        log.warn("review_requested was missing subject.url_data.number");
                        continue;
                    }
                    if (!rawEvent.repository.owner) {
                        log.warn("review_requested was missing repository.owner");
                        continue;
                    }
                    rawEvent.subject.requested_reviewers = (await this.octoKit.pulls.listRequestedReviewers({
                        pull_number: rawEvent.subject.url_data.number,
                        owner: rawEvent.repository.owner.login,
                        repo: rawEvent.repository.name,
                    })).data;
                    rawEvent.subject.reviews = (await this.octoKit.pulls.listReviews({
                        pull_number: rawEvent.subject.url_data.number,
                        owner: rawEvent.repository.owner.login,
                        repo: rawEvent.repository.name,
                    })).data;
                }
            } catch (ex) {
                log.warn(`Failed to pre-process ${rawEvent.id}: ${ex}`);
                // We still push
            }
            log.debug(`Pushing ${rawEvent.id}`);
            this.emit("new_events", {
                eventName: "notifications.user.events",
                data: {
                    roomId: this.roomId,
                    events: [rawEvent],
                    lastReadTs: this.lastReadTs,
                },
                sender: "GithubWebhooks",
            });
        }
    }

}