import {Appservice} from "matrix-bot-sdk";
import { IConnection, IConnectionState } from ".";
import { BridgeConfigFeeds } from "../Config/Config";
import { FeedEntry, FeedError} from "../feeds/FeedReader";
import LogWrapper from "../LogWrapper";
import { IBridgeStorageProvider } from "../Stores/StorageProvider";
import { BaseConnection } from "./BaseConnection";
import markdown from "markdown-it";

const log = new LogWrapper("FeedConnection");
const md = new markdown();

export interface FeedConnectionState extends IConnectionState {
    url: string;
}

export class FeedConnection extends BaseConnection implements IConnection {
    static readonly CanonicalEventType = "uk.half-shot.matrix-hookshot.feed";
    static readonly EventTypes = [ FeedConnection.CanonicalEventType ];
    private hasError = false;

    public get feedUrl(): string {
        return this.state.url;
    }

    constructor(
        roomId: string,
        stateKey: string,
        private state: FeedConnectionState,
        private readonly config: BridgeConfigFeeds,
        private readonly as: Appservice,
        private readonly storage: IBridgeStorageProvider
    ) {
        super(roomId, stateKey, FeedConnection.CanonicalEventType)
        log.info(`Connection ${this.connectionId} created for ${roomId}, ${JSON.stringify(state)}`);
    }

    public isInterestedInStateEvent(eventType: string, stateKey: string): boolean {
        return !!FeedConnection.EventTypes.find(e => e === eventType) && stateKey === this.feedUrl;
    }

    public async handleFeedEntry(entry: FeedEntry): Promise<void> {
        this.hasError = false;

        let entryDetails;
        if (entry.title && entry.link) {
            entryDetails = `[${entry.title}](${entry.link})`;
        } else {
            entryDetails = entry.title || entry.link;
        }

        let message = `New post in ${entry.feed.title || entry.feed.url}`;
        if (entryDetails) {
            message += `: ${entryDetails}`;
        }

        await this.as.botIntent.sendEvent(this.roomId, {
            msgtype: 'm.notice',
            format: "org.matrix.custom.html",
            formatted_body: md.renderInline(message),
            body: message,
        });
    }

    public async handleFeedError(error: FeedError): Promise<void> {
        if (!this.hasError) {
            await this.as.botIntent.sendEvent(this.roomId, {
                msgtype: 'm.notice',
                format: 'm.text',
                body: `Error fetching ${this.feedUrl}: ${error.cause.message}`
            });
            this.hasError = true;
        }
    }

    // needed to ensure that the connection is removable
    public async onRemove(): Promise<void> {
        log.info(`Removing connection ${this.connectionId}`);
    }

    toString(): string {
        return `FeedConnection ${this.state.url}`;
    }
}
