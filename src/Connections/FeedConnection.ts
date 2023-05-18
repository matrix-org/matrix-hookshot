import {Intent, StateEvent} from "matrix-bot-sdk";
import { IConnection, IConnectionState, InstantiateConnectionOpts } from ".";
import { ApiError, ErrCode } from "../api";
import { FeedEntry, FeedError, FeedReader} from "../feeds/FeedReader";
import { Logger } from "matrix-appservice-bridge";
import { BaseConnection } from "./BaseConnection";
import markdown from "markdown-it";
import { Connection, ProvisionConnectionOpts } from "./IConnection";
import { GetConnectionsResponseItem } from "../provisioning/api";
import { sanitizeHtml } from "../libRs";
const log = new Logger("FeedConnection");
const md = new markdown({
    html: true,
});

export interface LastResultOk {
    timestamp: number;
    ok: true;
}
export interface LastResultFail {
    timestamp: number;
    ok: false;
    error?: string;
}


export interface FeedConnectionState extends IConnectionState {
    url:    string;
    label?: string;
    template?: string;
    notifyOnFailure?: boolean;
}

export interface FeedConnectionSecrets {
    lastResults: Array<LastResultOk|LastResultFail>;
}

export type FeedResponseItem = GetConnectionsResponseItem<FeedConnectionState, FeedConnectionSecrets>;

const MAX_LAST_RESULT_ITEMS = 5;
const VALIDATION_FETCH_TIMEOUT_MS = 5000;
const MAX_SUMMARY_LENGTH = 512;
const MAX_TEMPLATE_LENGTH = 1024;

const DEFAULT_TEMPLATE = "New post in $FEEDNAME";
const DEFAULT_TEMPLATE_WITH_CONTENT = "New post in $FEEDNAME: $LINK"
const DEFAULT_TEMPLATE_WITH_ONLY_TITLE = "New post in $FEEDNAME: $TITLE"

@Connection
export class FeedConnection extends BaseConnection implements IConnection {
    static readonly CanonicalEventType = "uk.half-shot.matrix-hookshot.feed";
    static readonly EventTypes = [ FeedConnection.CanonicalEventType ];
    static readonly ServiceCategory = "feeds";
    

    public static createConnectionForState(roomId: string, event: StateEvent<any>, {config, intent}: InstantiateConnectionOpts) {
        if (!config.feeds?.enabled) {
            throw Error('RSS/Atom feeds are not configured');
        }
        return new FeedConnection(roomId, event.stateKey, event.content, intent);
    }

    static async validateUrl(url: string): Promise<void> {
        try {
            new URL(url);
        } catch (ex) {
            throw new ApiError("Feed URL doesn't appear valid", ErrCode.BadValue);
        }

        try {
            await FeedReader.fetchFeed(url, {}, VALIDATION_FETCH_TIMEOUT_MS);
        } catch (ex) {
            throw new ApiError(`Could not read feed from URL: ${ex.message}`, ErrCode.BadValue);
        }
    }

    static validateState(data: Record<string, unknown> = {}): FeedConnectionState {
        const url = data.url;
        if (typeof url !== 'string') {
            throw new ApiError('No URL specified', ErrCode.BadValue);
        }
        if (typeof data.label !== 'undefined' && typeof data.label !== 'string') {
            throw new ApiError('Label must be a string', ErrCode.BadValue);
        }

        if (typeof data.template !== 'undefined') {
            if (typeof data.template !== 'string') {
                throw new ApiError('Template must be a string', ErrCode.BadValue);
            }
            // Sanity to prevent slowing hookshot down with massive templates.
            if (data.template.length > MAX_TEMPLATE_LENGTH) {
                throw new ApiError(`Template should not be longer than ${MAX_TEMPLATE_LENGTH} characters`, ErrCode.BadValue);
            }
        }


        return { url, label: data.label, template: data.template };
    }

    static async provisionConnection(roomId: string, _userId: string, data: Record<string, unknown> = {}, { intent, config }: ProvisionConnectionOpts) {
        if (!config.feeds?.enabled) {
            throw new ApiError('RSS/Atom feeds are not configured', ErrCode.DisabledFeature);
        }

        const state = this.validateState(data);
        await FeedConnection.validateUrl(state.url);
        const connection = new FeedConnection(roomId, state.url, state, intent);
        await intent.underlyingClient.sendStateEvent(roomId, FeedConnection.CanonicalEventType, state.url, state);

        return {
            connection,
            stateEventContent: state,
        }
    }

    public static getProvisionerDetails(botUserId: string) {
        return {
            service: "feeds",
            eventType: FeedConnection.CanonicalEventType,
            type: "Feed",
            botUserId: botUserId,
        }
    }

    public getProvisionerDetails(): FeedResponseItem {
        return {
            ...FeedConnection.getProvisionerDetails(this.intent.userId),
            id: this.connectionId,
            config: {
                url: this.feedUrl,
                label: this.state.label,
            },
            secrets: {
                lastResults: this.lastResults,
            }
        }
    }

    public templateFeedEntry(template: string, entry: FeedEntry) {
        return template.replace(/(\$[A-Z]+)/g, (token: string) => {
            switch(token) {
                case "$FEEDNAME":
                    return this.state.label || entry.feed.title || entry.feed.url || "";
                case "$FEEDURL":
                    return entry.feed.url || "";
                case "$FEEDTITLE":
                    return entry.feed.title || "";
                case "$TITLE":
                    return entry.title || "";
                case "$LINK":
                    return entry.link ? `[${entry.title ?? entry.link}](${entry.link})` : "";
                case "$URL":
                    return entry.link || "";
                case "$AUTHOR":
                    return entry.author || "";
                case "$DATE":
                    return entry.pubdate || "";
                case "$SUMMARY":
                    return entry.summary || "";
                default:
                    return token;
            }
        });
    }

    private hasError = false;
    private readonly lastResults = new Array<LastResultOk|LastResultFail>();

    public get feedUrl(): string {
        return this.state.url;
    }

    constructor(
        roomId: string,
        stateKey: string,
        private state: FeedConnectionState,
        private readonly intent: Intent,
    ) {
        super(roomId, stateKey, FeedConnection.CanonicalEventType)
        log.info(`Connection ${this.connectionId} created for ${roomId}, ${JSON.stringify(state)}`);
    }

    public isInterestedInStateEvent(eventType: string, stateKey: string): boolean {
        return !!FeedConnection.EventTypes.find(e => e === eventType) && stateKey === this.feedUrl;
    }

    public async handleFeedEntry(entry: FeedEntry): Promise<void> {
        // We will need to tidy this up.
        if (this.state.template?.includes('$SUMMARY') && entry.summary) {
            // This might be massive and cause us to fail to send the message
            // so confine to a maximum size.
            if (entry.summary.length > MAX_SUMMARY_LENGTH) {
                entry.summary = entry.summary?.substring(0, MAX_SUMMARY_LENGTH) + "…" ?? null;
            }
            entry.summary = sanitizeHtml(entry.summary);
        }

        let message;
        if (this.state.template) {
            message = this.templateFeedEntry(this.state.template, entry);
        } else if (entry.link) {
            message = this.templateFeedEntry(DEFAULT_TEMPLATE_WITH_CONTENT, entry);
        } else if (entry.title) {
            message = this.templateFeedEntry(DEFAULT_TEMPLATE_WITH_ONLY_TITLE, entry);
        } else {
            message = this.templateFeedEntry(DEFAULT_TEMPLATE, entry);
        }

        await this.intent.sendEvent(this.roomId, {
            msgtype: 'm.notice',
            format: "org.matrix.custom.html",
            formatted_body: md.renderInline(message),
            body: message,
            external_url: entry.link ?? undefined,
            "uk.half-shot.matrix-hookshot.feeds.item": entry,
        });
    }

    public handleFeedSuccess() {
        this.hasError = false;
        this.lastResults.unshift({
            ok: true,
            timestamp: Date.now(),
        });
        this.lastResults.splice(MAX_LAST_RESULT_ITEMS-1, 1);
    }

    public async handleFeedError(error: FeedError): Promise<void> {
        this.lastResults.unshift({
            ok: false,
            timestamp: Date.now(),
            error: error.message,
        });
        this.lastResults.splice(MAX_LAST_RESULT_ITEMS-1, 1);
        const wasLastResultSuccessful = this.lastResults[0]?.ok !== false;
        if (wasLastResultSuccessful && error.shouldErrorBeSilent) {
            // To avoid short term failures bubbling up, if the error is serious, we still bubble.
            return;
        }
        if (!this.state.notifyOnFailure) {
            // User hasn't opted into notifications on failure
            return;
        }
        if (!this.hasError) {
            await this.intent.sendEvent(this.roomId, {
                msgtype: 'm.notice',
                format: 'm.text',
                body: `Error fetching ${this.feedUrl}: ${error.cause.message}`
            });
            this.hasError = true;
        }
    }

    public async provisionerUpdateConfig(userId: string, config: Record<string, unknown>) {
        // Apply previous state to the current config, as provisioners might not return "unknown" keys.
        config = { ...this.state, ...config };
        const validatedConfig = FeedConnection.validateState(config);
        if (validatedConfig.url !== this.feedUrl) {
            throw new ApiError('Cannot alter url of existing feed. Please create a new one.', ErrCode.BadValue);
        }
        await this.intent.underlyingClient.sendStateEvent(this.roomId, FeedConnection.CanonicalEventType, this.stateKey, validatedConfig);
        this.state = validatedConfig;
    }
    
    // needed to ensure that the connection is removable
    public async onRemove(): Promise<void> {
        log.info(`Removing connection ${this.connectionId}`);
        await this.intent.underlyingClient.sendStateEvent(this.roomId, FeedConnection.CanonicalEventType, this.feedUrl, {});
    }

    toString(): string {
        return `FeedConnection ${this.state.url}`;
    }
}
