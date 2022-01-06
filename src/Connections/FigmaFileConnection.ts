import { Appservice, MatrixClient, RichReply } from "matrix-bot-sdk";
import markdownit from "markdown-it";
import { FigmaPayload } from "../figma/types";
import { BaseConnection } from "./BaseConnection";
import { IConnection } from ".";
import LogWrapper from "../LogWrapper";
import { IBridgeStorageProvider } from "../Stores/StorageProvider";
import { BridgeConfigFigma } from "../Config/Config";

const log = new LogWrapper("FigmaFileConnection");

export interface FigmaFileConnectionState {
    fileId?: string;
    instanceName?: string;
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


    constructor(
        roomId: string,
        stateKey: string,
        private state: FigmaFileConnectionState,
        private readonly config: BridgeConfigFigma,
        private readonly as: Appservice,
        private readonly storage: IBridgeStorageProvider) {
        super(roomId, stateKey, FigmaFileConnection.CanonicalEventType)
    }

    public isInterestedInStateEvent() {
        return false; // We don't support state-updates...yet.
    }

    public get fileId() {
        return this.state.fileId;
    }

    public get instanceName() {
        return this.state.instanceName;
    }

    public async handleNewComment(payload: FigmaPayload) {
        // We need to check if the comment was actually new.
        // There isn't a way to tell how the comment has changed, so for now check the timestamps
        const age = Date.now() - Date.parse(payload.created_at);
        if (age > 5000) {
            // Comment was created at least 5 seconds before the webhook, ignore it.
            log.warn(`Comment ${payload.comment_id} is stale, ignoring (${age}ms old)`);
            return;
        }

        const intent = this.as.getIntentForUserId(this.config.overrideUserId || this.as.botUserId);
    
        const permalink = `https://www.figma.com/file/${payload.file_key}#${payload.comment_id}`;
        const comment = payload.comment.map(({text}) => text).join("\n");
        const empty = "‎"; // This contains an empty character to thwart the notification matcher.
        const name = payload.triggered_by.handle.split(' ').map(p => p[0] + empty + p.slice(1)).join(' ');
        const parentEventId = await this.storage.getFigmaCommentEventId(this.roomId, payload.parent_id);
        let content;
        if (parentEventId) {
            const parentEvent = intent.underlyingClient.getEvent(this.roomId, parentEventId);
            const body = `**${name}**: ${comment}`;
            content = RichReply.createFor(this.roomId, parentEvent, body, md.renderInline(body));
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
        const eventId = await intent.sendEvent(this.roomId, content);
        await this.storage.setFigmaCommentEventId(this.roomId, payload.comment_id, eventId);
    }
}
