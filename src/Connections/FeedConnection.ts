import {Appservice, StateEvent} from "matrix-bot-sdk";
import { IConnection, IConnectionState, InstantiateConnectionOpts } from ".";
import { BridgeConfigFeeds } from "../Config/Config";
import { FeedEntry, FeedError} from "../feeds/FeedReader";
import LogWrapper from "../LogWrapper";
import { IBridgeStorageProvider } from "../Stores/StorageProvider";
import { BaseConnection } from "./BaseConnection";
import markdown from "markdown-it";
import { Connection, ProvisionConnectionOpts } from "./IConnection";
import { GetConnectionsResponseItem } from "../provisioning/api";

const log = new LogWrapper("FeedConnection");
const md = new markdown();

export interface FeedConnectionState extends IConnectionState {
    url: string;
}

export type FeedResponseItem = GetConnectionsResponseItem<FeedConnectionState, object>;

@Connection
export class FeedConnection extends BaseConnection implements IConnection {
    static readonly CanonicalEventType = "uk.half-shot.matrix-hookshot.feed";
    static readonly EventTypes = [ FeedConnection.CanonicalEventType ];
    static readonly ServiceCategory = "feed";

    public static createConnectionForState(roomId: string, event: StateEvent<any>, {config, as, storage}: InstantiateConnectionOpts) {
        if (!config.feeds?.enabled) {
            throw Error('RSS/Atom feeds are not configured');
        }
        return new FeedConnection(roomId, event.stateKey, event.content, config.feeds, as, storage);
    }

    static async provisionConnection(roomId: string, _userId: string, data: Record<string, unknown> = {}, {as, config, storage}: ProvisionConnectionOpts) {
        if (!config.feeds?.enabled) {
            throw Error('RSS/Atom feeds are not configured');
        }

        const url = data.url;
        if (typeof url !== 'string') {
            throw new Error('No URL specified');
        }
        try {
            new URL(url);
            // TODO: fetch and check content-type?
        } catch {
            throw new Error(`${url} doesn't look like a valid feed URL`);
        }

        const state = { url };

        const connection = new FeedConnection(roomId, url, state, config.feeds!, as, storage);
        await as.botClient.sendStateEvent(roomId, FeedConnection.CanonicalEventType, url, state);

        return {
            connection,
            stateEventContent: { url },
        }
    }

    public static getProvisionerDetails(botUserId: string) {
        return {
            service: "feeds",
            eventType: FeedConnection.CanonicalEventType,
            type: "Feed",
            // TODO: Add ability to configure the bot per connnection type.
            botUserId: botUserId,
        }
    }

    public getProvisionerDetails(showSecrets = false): FeedResponseItem {
        return {
            ...FeedConnection.getProvisionerDetails(this.as.botUserId),
            id: this.connectionId,
            config: {
                url: this.feedUrl
            },
        }
    }

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
