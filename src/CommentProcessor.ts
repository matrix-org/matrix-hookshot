import { IssuesGetCommentResponse } from "@octokit/rest";
import { Appservice } from "matrix-bot-sdk";
import request from "request-promise-native";
import markdown from "markdown-it";
import mime from "mime";
import emoji from "node-emoji";
import { MatrixMessageContent } from "./MatrixEvent";
import { LogWrapper } from "./LogWrapper";

const REGEX_MENTION = /(^|\s)(@[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38})(\s|$)/ig;
const REGEX_MATRIX_MENTION = /<a href="https:\/\/matrix\.to\/#\/(.+)">(.*)<\/a>/gmi;
const REGEX_IMAGES = /!\[.*]\((.*\.(\w+))\)/gm;
const md = new markdown();
const log = new LogWrapper("CommentProcessor");

interface IMatrixCommentEvent {
    msgtype: string;
    body: string;
    formatted_body: string;
    format: string;
    external_url: string;
    "uk.half-shot.matrix-github.comment": {
        id: number;
    };
}

export class CommentProcessor {
    constructor(private as: Appservice, private mediaUrl: string) {}

    public async getCommentBodyForEvent(event: MatrixMessageContent): Promise<string> {
        let body = event.body;
        body = await this.replaceImages(body, false);
        if (event.formatted_body) {
            body = this.replaceMatrixMentions(body, event.formatted_body);
        }
        return body;
    }

    public async getEventBodyForComment(comment: IssuesGetCommentResponse): Promise<IMatrixCommentEvent> {
        let body = comment.body;
        body = this.replaceMentions(body);
        body = await this.replaceImages(body, true);
        body = emoji.emojify(body);
        const htmlBody = md.render(body);
        return {
            body,
            "formatted_body": htmlBody,
            "msgtype": "m.text",
            "format": "org.matrix.custom.html",
            "external_url": comment.html_url,
            "uk.half-shot.matrix-github.comment": {
                id: comment.id,
            },
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
            const contentType = mime.getType(match[1]) || "none";
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
                const imageData = await request.get(rawUrl, { encoding: null});
                const contentType = mime.getType(rawUrl) || "application/octet-stream";
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
                log.warn("Failed to upload file");
            }
        }
        return body;
    }
}
