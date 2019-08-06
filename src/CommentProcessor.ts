import { IssuesGetCommentResponse } from "@octokit/rest";
import { Appservice } from "matrix-bot-sdk";
import request from "request-promise-native";
import markdown from "markdown-it";
import mime from "mime";
import emoji from "node-emoji";

const md = new markdown();
const REGEX_MENTION = /(^|\s)(@[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38})(\s|$)/ig;
const REGEX_IMAGES = /!\[.*]\((.*\.(\w+))\)/gm;

interface IMatrixCommentEvent {
    msgtype: string;
    body: string;
    formatted_body: string;
    format: string;
    external_url:string;
    "uk.half-shot.matrix-github.comment": {
        id: number;
    };
}

export class CommentProcessor {
    constructor (private as: Appservice) {}

    public async getEventBodyForComment(comment: IssuesGetCommentResponse): Promise<IMatrixCommentEvent> {
        let body = comment.body;
        body = this.replaceMentions(body);
        body = await this.replaceImages(body);
        body = emoji.emojify(body);
        let htmlBody = md.render(body);
        console.log(body, htmlBody);
        return {
            body,
            formatted_body: htmlBody,
            msgtype: "m.text",
            format: "org.matrix.custom.html",
            external_url: comment.html_url,
            "uk.half-shot.matrix-github.comment": {
                id: comment.id,
            },
        }
    }

    private replaceMentions(body: string): string {
        return body.replace(REGEX_MENTION, (_match: string, _part1: string, githubId: string) => {
            const userId = this.as.getUserIdForSuffix(githubId.substr(1));
            return `[$2](https://matrix.to/#/${userId})`;
        });
    }

    private async replaceImages(body: string): Promise<string> {
        let match;
        let bodyCopy = body;
        let urlMatches: string[] = [];
        while(match = REGEX_IMAGES.exec(bodyCopy)) {
            bodyCopy = bodyCopy.replace(match[1], "");
            const contentType = mime.getType(match[1]) || "none";
            if (!contentType.startsWith("image") && !contentType.startsWith("video") && !contentType.startsWith("audio")) {
                // Not handling media.
                continue;
            }
            urlMatches.push(match[1]);
        }
        for (const rawUrl of urlMatches) {
            try {
                const imageData = await request.get(rawUrl, { encoding: null});
                const contentType = mime.getType(rawUrl) || "application/octet-stream";
                const url = await this.as.botIntent.underlyingClient.uploadContent(imageData, contentType);
                body = body.replace(rawUrl, url);
            } catch (ex) {
                console.warn("Failed to upload file");
            }
        }
        return body;
    }
}