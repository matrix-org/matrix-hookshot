import { MessageSenderClient } from "./MatrixSender";
import { IStorageProvider } from "./Stores/StorageProvider";
import { UserNotificationsEvent, UserNotification } from "./UserNotificationWatcher";
import { LogWrapper } from "./LogWrapper";
import { AdminRoom } from "./AdminRoom";
import markdown from "markdown-it";
import { Octokit } from "@octokit/rest";
import { FormatUtil } from "./FormatUtil";

const log = new LogWrapper("GithubBridge");
const md = new markdown();

export interface IssueDiff {
    state: null|string;
    assignee: null|Octokit.IssuesGetResponseAssignee;
    title: null|string;
}

export interface CachedReviewData {
    requested_reviewers: Octokit.PullsListReviewRequestsResponse;
    reviews: Octokit.PullsListReviewsResponse;
}
export class NotificationProcessor {
    private static formatNotification(notif: UserNotification, diff: IssueDiff|null, newComment: boolean) {
        let plain = `${this.getEmojiForNotifType(notif)} [${notif.subject.title}](${notif.subject.url_data?.html_url})`;
        const issueNumber = notif.subject.url_data?.number;
        if (issueNumber) {
            plain += ` #${issueNumber}`;
        }
        if (notif.repository) {
            plain += ` for **[${notif.repository.full_name}](${notif.repository.html_url})**`;
        }
        if (diff) {
            plain += "\n\n ";
            if (diff.state) {
                const state = diff.state[0].toUpperCase() + diff.state.slice(1).toLowerCase();
                plain += `State changed to: ${state}`;
            }
            if (diff.title) {
                plain += `Title changed to: ${diff.title}`;
            }
            if (diff.assignee) {
                plain += `Assigned to: ${diff.assignee.login}`;
            }
        }
        if (newComment) {
            const comment = notif.subject.latest_comment_url_data as Octokit.IssuesGetCommentResponse;
            plain += `\n\n **[${comment.user.login}](${comment.user.html_url})**:\n\n > ${comment.body}`;
        }
        return {
            plain,
            html: md.render(plain),
        };
    }

    private static getEmojiForNotifType(notif: UserNotification): string {
        let reasonFlag = "";
        switch (notif.reason) {
            case "review_requested":
                reasonFlag = "🚩";
                break;
        }
        switch (notif.subject.type) {
            case "Issue":
                return "📝";
            case "PullRequest":
                return `⤵+${reasonFlag}`;
            case "RepositoryVulnerabilityAlert":
                return "⚠️";
            default:
                return "🔔";
        }
    }

    constructor(private storage: IStorageProvider, private matrixSender: MessageSenderClient) {

    }

    public async onUserEvents(msg: UserNotificationsEvent, adminRoom: AdminRoom) {
        log.info(`Got new events for ${adminRoom.userId} ${msg.events.length}`);
        for (const event of msg.events) {
            const isIssueOrPR = event.subject.type === "Issue" || event.subject.type === "PullRequest";
            try {
                await this.handleUserNotification(msg.roomId, event);
                if (isIssueOrPR && event.subject.url_data) {
                    const issueNumber = event.subject.url_data.number.toString();
                    await this.storage.setGithubIssue(
                        event.repository.full_name,
                        issueNumber,
                        event.subject.url_data,
                        msg.roomId,
                    );
                    if (event.subject.latest_comment_url) {
                        await this.storage.setLastNotifCommentUrl(
                            event.repository.full_name,
                            issueNumber,
                            event.subject.latest_comment_url,
                            msg.roomId,
                        );
                    }

                    if (event.subject.requested_reviewers && event.subject.reviews) {
                        await this.storage.setPRReviewData(
                            event.repository.full_name,
                            issueNumber,
                            event.subject as CachedReviewData,
                            msg.roomId,
                        );
                    }
                }

            } catch (ex) {
                log.warn("Failed to handle event:", ex);
            }
        }
        try {
            await adminRoom.setNotifSince(msg.lastReadTs);
        } catch (ex) {
            log.error("Failed to update stream position for notifications:", ex);
        }
    }

    private async diffReviewChanges(roomId: string, notif: UserNotification) {
        const issueNumber = notif.subject.url_data!.number.toString();
        const diff = {
            newReviewers: [] as string[],
            removedReviewers: [] as string[],
            completedReviews: [] as string[],
        };

        const existingData: CachedReviewData|null = await this.storage.getPRReviewData(
            notif.repository.full_name,
            issueNumber,
            roomId,
        );

        const newData = notif.subject as CachedReviewData;

        if (existingData === null) {
            // Treat everyone as new.
            diff.newReviewers = diff.newReviewers.concat(
                notif.subject.requested_reviewers!.users.map((u) => u.login),
                notif.subject.requested_reviewers!.teams.map((t) => t.name)
            );
            return diff;
        }
    }

    private formatReviewRequest(notif: UserNotification) {
        const issue = notif.subject.url_data!;
        const body = `🚩 Review Requested for [${issue.title} #${issue.number}](${issue.html_url}) - `
            + ` **[${notif.repository.full_name}](${notif.repository.html_url})**`;
        return {
            ...FormatUtil.getPartialBodyForRepo(notif.repository),
            msgtype: "m.text",
            body,
            formatted_body: md.render(body),
            format: "org.matrix.custom.html",
        };
    }

    private formatSecurityAlert(notif: UserNotification) {
        const body = `⚠️ ${notif.subject.title} - `
            + `for **[${notif.repository.full_name}](${notif.repository.html_url})**`;
        return {
            ...FormatUtil.getPartialBodyForRepo(notif.repository),
            msgtype: "m.text",
            body,
            formatted_body: md.render(body),
            format: "org.matrix.custom.html",
        };
    }

    private diffIssueChanges(curr: Octokit.IssuesGetResponse, prev: Octokit.IssuesGetResponse): IssueDiff {
        const diff: IssueDiff = {
            state: curr.state === prev.state ? null : curr.state,
            assignee: curr.assignee?.id === prev.assignee?.id ? null : curr.assignee,
            title: curr.title === prev.title ? null : curr.title,
        };
        return diff;
    }

    private async formatIssueOrPullRequest(roomId: string, notif: UserNotification) {
        const issueNumber = notif.subject.url_data?.number.toString();
        let diff = null;
        if (issueNumber) {
            const prevIssue: Octokit.IssuesGetResponse|null = await this.storage.getGithubIssue(
                notif.repository.full_name, issueNumber, roomId);
            if (prevIssue && notif.subject.url_data) {
                diff = this.diffIssueChanges(notif.subject.url_data, prevIssue);
            }
        }

        const newComment = !!notif.subject.latest_comment_url && !!issueNumber && notif.subject.latest_comment_url !==
            (await this.storage.getLastNotifCommentUrl(notif.repository.full_name, issueNumber, roomId));

        const formatted = NotificationProcessor.formatNotification(notif, diff, newComment);
        let body: any = {
            msgtype: "m.text",
            body: formatted.plain,
            formatted_body: formatted.html,
            format: "org.matrix.custom.html",
        };
        if (newComment && notif.subject.latest_comment_url_data && notif.repository) {
            // Get the details
            body = {
                ...body,
                ...FormatUtil.getPartialBodyForComment(
                    notif.subject.latest_comment_url_data,
                   notif.repository,
                    notif.subject.url_data,
                ),
            };
        } else if (notif.subject.url_data && notif.repository) {
            body = {
                ...body,
                ...FormatUtil.getPartialBodyForIssue(
                    notif.repository,
                    notif.subject.url_data,
                ),
            };
        }
        return this.matrixSender.sendMatrixMessage(roomId, body);
    }

    private async handleUserNotification(roomId: string, notif: UserNotification) {
        log.info("New notification event:", notif);
        if (notif.reason === "security_alert") {
            return this.matrixSender.sendMatrixMessage(roomId, this.formatSecurityAlert(notif));
        } else if (notif.subject.type === "Issue" || notif.subject.type === "PullRequest") {
            return this.formatIssueOrPullRequest(roomId, notif);
        }
        // We don't understand this type yet
        const genericNotif = NotificationProcessor.formatNotification(notif, null, false);
        return this.matrixSender.sendMatrixMessage(roomId, {
            msgtype: "m.text",
            body: genericNotif.plain,
            formatted_body: genericNotif.html,
            format: "org.matrix.custom.html",
        });
    }
}