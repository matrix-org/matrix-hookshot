import { IConnection } from "./IConnection";
import { Appservice } from "matrix-bot-sdk";
import LogWrapper from "../LogWrapper";
import { CommentProcessor } from "../CommentProcessor";
import { MessageSenderClient } from "../MatrixSender"
import { JiraIssueEvent } from "../Jira/WebhookTypes";
import { FormatUtil } from "../FormatUtil";
import markdownit from "markdown-it";

export interface JiraProjectConnectionState {
    id: string;
}

const log = new LogWrapper("JiraProjectConnection");
const md = new markdownit();

/**
 * Handles rooms connected to a github repo.
 */
export class JiraProjectConnection implements IConnection {
    static readonly CanonicalEventType = "uk.half-shot.matrix-github.jira.project";

    static readonly EventTypes = [
        JiraProjectConnection.CanonicalEventType,
    ];

    static getTopicString(authorName: string, state: string) {
        `Author: ${authorName} | State: ${state === "closed" ? "closed" : "open"}`
    }
    
    public get projectId() {
        return this.state.id;
    }

    constructor(public readonly roomId: string,
        private readonly as: Appservice,
        private state: JiraProjectConnectionState,
        private readonly stateKey: string,
        private commentProcessor: CommentProcessor,
        private messageClient: MessageSenderClient,) {
        }

    public isInterestedInStateEvent(eventType: string, stateKey: string) {
        return JiraProjectConnection.EventTypes.includes(eventType) && this.stateKey === stateKey;
    }

    public async onJiraIssueCreated(data: JiraIssueEvent) {
        log.info(`onIssueCreated ${this.roomId} ${this.projectId} ${data.issue.id}`);
        const creator = data.issue.fields.creator;
        if (!creator) {
            throw Error('No creator field');
        }
        const content = `${creator.displayName} created new issue [${data.issue.key}](${data.issue.self}): "${data.issue.fields.summary}"`;
        await this.as.botIntent.sendEvent(this.roomId, {
            msgtype: "m.notice",
            body: content,
            formatted_body: md.renderInline(content),
            format: "org.matrix.custom.html",
            // TODO: Fix types.
            ...FormatUtil.getPartialBodyForJiraIssue(data.issue)
        });
    }

    public toString() {
        return `JiraProjectConnection ${this.projectId}`;
    }
}