import { Octokit } from '@octokit/rest';
import { UserNotification } from './UserNotificationWatcher';
import markdown from "markdown-it";

const md = new markdown();

export class FormatUtil {
    public static formatName(issue: Octokit.IssuesGetResponse) {
        const orgRepoName = issue.repository_url.substr("https://api.github.com/repos/".length);
        return `${orgRepoName}#${issue.number}: ${issue.title}`;
    }

    public static formatTopic(issue: Octokit.IssuesGetResponse) {
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
        }
    }

    private static getEmojiForNotifType(notif: UserNotification): string {
        switch(notif.subject.type) {
            case "Issue":
                return "📝";
            case "PullRequest":
                return "✋"; // What should we do about this?
            default: 
                return "🔔";
        }
    }
}
