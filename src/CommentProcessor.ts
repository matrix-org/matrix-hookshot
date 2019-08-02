import { IssuesGetCommentResponse } from "@octokit/rest";
import { Appservice } from "matrix-bot-sdk";
import markdown from "markdown-it";

const md = new markdown();
const REGEX_MENTION = /(^|\s)(@[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38})(\s|$)/ig;

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

    public getEventBodyForComment(comment: IssuesGetCommentResponse): IMatrixCommentEvent {
        let body = comment.body;
        body = body.replace(REGEX_MENTION, (_match: string, _part1: string, githubId: string) => {
            const userId = this.as.getUserIdForSuffix(githubId.substr(1));
            return `[$2](https://matrix.to/#/${userId})`;
        });
        return {
            body,
            formatted_body: md.render(body),
            msgtype: "m.text",
            format: "org.matrix.custom.html",
            external_url: comment.html_url,
            "uk.half-shot.matrix-github.comment": {
                id: comment.id,
            },
        }
    }
}