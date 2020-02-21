export class FormatUtil {
    public static formatRoomName(issue: {number: number, title: string, repository_url: string}) {
        const orgRepoName = issue.repository_url.substr("https://api.github.com/repos/".length);
        return `${orgRepoName}#${issue.number}: ${issue.title}`;
    }

    public static formatRoomTopic(issue: {state: string, title: string, html_url: string}) {
        return `${issue.title} | Status: ${issue.state} | ${issue.html_url}`;
    }
}
