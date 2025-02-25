import { Appservice } from "matrix-bot-sdk";
import markdown from "markdown-it";
import emoji from "node-emoji";
import { MatrixMessageContent, MatrixEvent } from "./MatrixEvent";
import { Logger } from "matrix-appservice-bridge";
import axios from "axios";
import { FormatUtil } from "./FormatUtil";
import { IssuesGetCommentResponseData, ReposGetResponseData, IssuesGetResponseData } from "./github/Types"
import { IGitLabWebhookNoteEvent } from "./Gitlab/WebhookTypes";

const REGEX_MENTION = /(^|\s)(@[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38})(\s|$)/ig;
const REGEX_MATRIX_MENTION = /<a href="https:\/\/matrix\.to\/#\/(.+)">(.*)<\/a>/gmi;
const REGEX_IMAGES = /!\[.*]\((.*\.(\w+))\)/gm;
const md = new markdown();
const log = new Logger("CommentProcessor");
const mime = import('mime');

interface IMatrixCommentEvent extends MatrixMessageContent {
    external_url: string;
    "uk.half-shot.matrix-hookshot.github.comment": {
        id: number;
    };
}

export class CommentProcessor {
    private processedComments = new Set<string>();
    private processedEvents = new Set<string>();

    constructor(private as: Appservice, private mediaUrl: string) {}

    public hasCommentBeenProcessed(org: string, repo: string, issue: string, id: number) {
        return this.processedComments.has(`${org}/${repo}#${issue}~${id}`.toLowerCase());
    }

    public markCommentAsProcessed(org: string, repo: string, issue: string, id: number) {
        this.processedComments.add(`${org}/${repo}#${issue}~${id}`.toLowerCase());
    }

    public hasEventBeenProcessed(roomId: string, eventId: string) {
        return this.processedEvents.has(`${roomId}/${eventId}`);
    }

    public markEventAsProcessed(roomId: string, eventId: string) {
        this.processedEvents.add(`${roomId}/${eventId}`);
    }

    public async getCommentBodyForEvent(event: MatrixEvent<MatrixMessageContent>, asBot: boolean): Promise<string> {
        let body = event.content.body;
        body = await this.replaceImages(body, false);
        if (event.content.formatted_body) {
            body = this.replaceMatrixMentions(body, event.content.formatted_body);
        }
        if (asBot) {
            body = `[${event.sender}](https://matrix.to/#/${event.sender}): ${body}`
        }
        return body;
    }

    public async getEventBodyForGitHubComment(comment: IssuesGetCommentResponseData,
                                        repo?: ReposGetResponseData,
                                        issue?: IssuesGetResponseData): Promise<IMatrixCommentEvent|undefined> {
        if (!comment.body) {
            return undefined;
        }
        let body = comment.body;
        body = this.replaceMentions(body);
        body = await this.replaceImages(body, true);
        body = emoji.emojify(body);
        const htmlBody = md.render(body);
        return {
            body,
            formatted_body: htmlBody,
            msgtype: "m.text",
            format: "org.matrix.custom.html",
            ...FormatUtil.getPartialBodyForComment(comment, repo, issue)
        };
    }

    public async getEventBodyForGitLabNote(comment: IGitLabWebhookNoteEvent): Promise<MatrixMessageContent> {
        let body = comment.object_attributes.note;
        body = this.replaceMentions(body);
        body = await this.replaceImages(body, true);
        body = emoji.emojify(body);
        const htmlBody = md.render(body);
        return {
            body,
            formatted_body: htmlBody,
            msgtype: "m.text",
            format: "org.matrix.custom.html",
            // ...FormatUtil.getPartialBodyForComment(comment, repo, issue)
        };
    }

    private replaceMentions(body: string): string {
        return body.replace(REGEX_MENTION, (match: string, part1: string, githubId: string) => {
            const userId = this.as.getUserIdForSuffix(githubId.substr(1));
            return `[${githubId}](https://matrix.to/#/${userId})`;
        });
    }

    private replaceMatrixMentions(body: string, formattedBody: string): string {
        let match;
        let bodyCopy = formattedBody;
        const mentionMatches: string[][] = [];
        match = REGEX_MATRIX_MENTION.exec(bodyCopy);
        while (match) {
            bodyCopy = bodyCopy.replace(match[0], "");
            mentionMatches.push([match[2], match[1]]);
            match = REGEX_MATRIX_MENTION.exec(bodyCopy);
        }

        for (const [full, userId] of mentionMatches) {
            if (this.as.isNamespacedUser(userId)) {
                // XXX: Prefix hack
                const githubId = userId.split(":")[0].substr("@_github_".length);
                if (!githubId) {
                    continue;
                }
                body = body.replace(full, `@${githubId}`);
            } else {
                body = body.replace(full, `[${userId}](https://matrix.to/#/${userId})`);
            }
        }
        return body;
    }

    private async replaceImages(body: string, convertToMxc: boolean): Promise<string> {
        let bodyCopy = body;
        const urlMatches: string[] = [];
        let match = REGEX_IMAGES.exec(bodyCopy);
        while (match) {
            bodyCopy = bodyCopy.replace(match[1], "");
            const contentType = (await mime).default.getType(match[1]) || "none";
            if (
                !contentType.startsWith("image") &&
                !contentType.startsWith("video") &&
                !contentType.startsWith("audio")) {
                // Not handling media.
                urlMatches.push(match[1]);
            }
            match = REGEX_IMAGES.exec(bodyCopy);
        }
        for (const rawUrl of urlMatches) {
            try {
                const { data, headers } = await axios.get(rawUrl, {responseType: "arraybuffer"});
                const imageData = data;
                const contentType = headers["content-type"] || (await mime).default.getType(rawUrl) || "application/octet-stream";
                let url;
                if (convertToMxc) {
                    url = await this.as.botIntent.underlyingClient.uploadContent(imageData, contentType);
                } else if (rawUrl.startsWith("mxc://")) {
                    const mxcParts = rawUrl.substr("mxc://".length).split("/");
                    url = `${this.mediaUrl}/_matrix/media/r0/download/${mxcParts[0]}/${mxcParts[1]}`;
                } else {
                    url = rawUrl;
                }

                body = body.replace(rawUrl, url);
            } catch (ex) {
                log.warn("Failed to upload file", ex);
            }
        }
        return body;
    }
}
