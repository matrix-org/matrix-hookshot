import { MatrixClient, RichReply } from "matrix-bot-sdk";
import markdownit from "markdown-it";
import { FigmaPayload } from "../figma/types";
import { BaseConnection } from "./BaseConnection";
import { IConnection } from ".";
import LogWrapper from "../LogWrapper";

const log = new LogWrapper("FigmaFileConnection");

export interface FigmaFileConnectionState {
    fileId?: string;
}

const md = markdownit();
export class FigmaFileConnection extends BaseConnection implements IConnection {
    static readonly CanonicalEventType = "uk.half-shot.matrix-hookshot.figma.file";
    static readonly LegacyEventType = "uk.half-shot.matrix-figma.file"; // Magically import from matrix-figma

    static readonly EventTypes = [
        FigmaFileConnection.CanonicalEventType,
        FigmaFileConnection.LegacyEventType,
    ];

    public static async createState(roomId: string, fileId: string, client: MatrixClient) {
        await client.sendStateEvent(roomId, FigmaFileConnection.CanonicalEventType, fileId, {
            fileId: fileId,
        } as FigmaFileConnectionState);
    }

    private commentIdToEvent: Map<string,string> = new Map();

    constructor(roomId: string, stateKey: string, private state: FigmaFileConnectionState, public readonly client: MatrixClient) {
        super(roomId, stateKey, FigmaFileConnection.CanonicalEventType)
    }

    public isInterestedInStateEvent() {
        return false; // We don't support state-updates...yet.
    }

    public get fileId() {
        return this.state.fileId;
    }

    public async handleNewComment(payload: FigmaPayload) {
        // We need to check if the comment was actually new.
        // There isn't a way to tell how the comment has changed, so for now check the timestamps
        const age = Date.now() - Date.parse(payload.created_at);
        if (Date.now() - Date.parse(payload.created_at) > 5000) {
            // Comment was created at least 5 seconds before the webhook, ignore it.
            log.warn(`Comment ${payload.comment_id} is stale, ignoring (${age}ms old)`);
            return;
        }
    
        const permalink = `https://www.figma.com/file/${payload.file_key}#${payload.comment_id}`;
        const comment = payload.comment.map(({text}) => text).join("\n");
        const empty = "‎"; // This contains an empty character to thwart the notification matcher.
        const name = payload.triggered_by.handle.split(' ').map(p => p[0] + empty + p.slice(1)).join(' ');
        const parentEventId = this.commentIdToEvent.get(payload.parent_id);
        let content;
        if (parentEventId) {
            const body = `**${name}**: ${comment}`;
            content = RichReply.createFor(this.roomId, parentEventId, body, md.renderInline(body));
            content["msgtype"] = "m.notice";
        } else {
            const body = `**${name}** [commented](${permalink}) on [${payload.file_name}](https://www.figma.com/file/${payload.file_key}): ${comment}`;
            content = {
                "msgtype": "m.notice",
                "body": body,
                "formatted_body": md.renderInline(body),
                "format": "org.matrix.custom.html"
            };
        }
        content["uk.half-shot.matrix-hookshot.figma.comment_id"] = payload.comment_id;
        const eventId = await this.client.sendMessage(this.roomId, content);
        this.commentIdToEvent.set(payload.comment_id, {
            ...content,
            event_id: eventId,
            sender: await this.client.getUserId(),
        });
    }
}
