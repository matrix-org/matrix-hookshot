import { UserNotification } from "./UserNotificationWatcher";
import markdown from "markdown-it";

const md = new markdown();

export class FormatUtil {
    public static formatRoomName(issue: {number: number, title: string, repository_url: string}) {
        const orgRepoName = issue.repository_url.substr("https://api.github.com/repos/".length);
        return `${orgRepoName}#${issue.number}: ${issue.title}`;
    }

    public static formatRoomTopic(issue: {state: string, title: string, html_url: string}) {
        return `${issue.title} | Status: ${issue.state} | ${issue.html_url}`;
    }

    public static formatNotification(notif: UserNotification): {plain: string, html: string} {
        let plain = `${this.getEmojiForNotifType(notif)} [${notif.subject.title}](${notif.subject.url_data.html_url})`;
        if (notif.repository) {
            plain += ` for **[${notif.repository.full_name}](${notif.repository.html_url})**`;
        }
        const commentData = notif.subject.latest_comment_url_data;
        if (commentData && commentData.body) {
            plain += `\n\n**@${commentData.user.login}**: ${commentData.body}`;
        }
        return {
            plain,
            html: md.render(plain),
        };
    }

    // private static getPhraselineForNotification(notif: UserNotification) {
    //     // opened a new issue
    //     const actionLine = "";
    //     return actionLine;
    // }

    // private static getReasonLine(notif: UserNotification) {
    //     switch (notif.reason) {
    //         case "assign":
    //             return `You were assigned to`;
    //         case "mention":
    //             return "You were mentioned";
    //         default:
    //             return "";
    //     }
    // }

    private static getEmojiForNotifType(notif: UserNotification): string {
        switch (notif.subject.type) {
            case "Issue":
                return "📝";
            case "PullRequest":
                return "⤵";
            default:
                return "🔔";
        }
    }
}
