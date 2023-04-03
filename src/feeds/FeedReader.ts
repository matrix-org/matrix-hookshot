import { MatrixClient, MatrixError } from "matrix-bot-sdk";
import { BridgeConfigFeeds } from "../Config/Config";
import { ConnectionManager } from "../ConnectionManager";
import { FeedConnection } from "../Connections";
import { Logger } from "matrix-appservice-bridge";
import { MessageQueue } from "../MessageQueue";

import Ajv from "ajv";
import axios, { AxiosResponse } from "axios";
import Parser from "rss-parser";
import Metrics from "../Metrics";
import UserAgent from "../UserAgent";
import { randomUUID } from "crypto";
import { StatusCodes } from "http-status-codes";
import { FormatUtil } from "../FormatUtil";

const log = new Logger("FeedReader");

export class FeedError extends Error {
    constructor(
        public url: string,
        public cause: Error,
        public readonly fetchKey: string,
    ) {
        super(`Error fetching feed ${url}: ${cause.message}`);
    }

    get shouldErrorBeSilent() {
        if (axios.isAxiosError(this.cause) && this.cause.response?.status) {
            if (this.cause.response.status % 500 < 100) {
                // 5XX error, retry these as it might be a server screwup.
                return true;
            } else if (this.cause.response.status % 400 < 100) {
                // 4XX error, actually report these because the server is explicity stating we can't read the resource.
                return false;
            }
        }
        if (axios.isAxiosError(this.cause) && this.cause.code && ['ECONNABORTED', 'ECONNRESET'].includes(this.cause.code)) {
            // Fuzzy match this, because it's usually a tempoary error.
            return true;
        }
        // Err on the side of safety and report the rest
        return false;
    }
}

export interface FeedEntry {
    feed: {
        title: string|null,
        url:   string,
    },
    title: string|null,
    link:  string|null,
    /**
     * Unique key to identify the specific fetch across entries.
     */
    fetchKey: string,
}

export interface FeedSuccess {
    url: string,
}

interface AccountData {
    [url: string]: string[],
}

const accountDataSchema = {
    type: 'object',
    patternProperties: {
        "https?://.+": {
            type: 'array',
            items: { type: 'string' },
        }
    },
    additionalProperties: false,
};
const ajv = new Ajv();
const validateAccountData = ajv.compile<AccountData>(accountDataSchema);

function stripHtml(input: string): string {
    return input.replace(/<[^>]*?>/g, '');
}

function normalizeUrl(input: string): string {
    const url = new URL(input);
    url.hash = '';
    return url.toString();
}

function shuffle<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

interface FeedItem {
    title?: string;
    link?: string;
    id?: string;
}

export class FeedReader {
    private static buildParser(): Parser {
        return new Parser();
    }

    /**
     * Read a feed URL and parse it into a set of items.
     * @param url The feed URL.
     * @param headers Any headers to provide.
     * @param timeoutMs How long to wait for the response, in milliseconds.
     * @param parser The parser instance. If not provided, this creates a new parser.
     * @returns The raw axios response, and the parsed feed.
     */
    public static async fetchFeed(
        url: string,
        headers: Record<string, string>,
        timeoutMs: number,
        parser: Parser = FeedReader.buildParser(),
    ): Promise<{ response: AxiosResponse, feed: Parser.Output<FeedItem> }> {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': UserAgent,
                ...headers,
            },
            // We don't want to wait forever for the feed.
            timeout: timeoutMs,
        });
        const feed = await parser.parseString(response.data);
        return { response, feed };
    }
    
    /**
     * Attempt to parse a link from a feed item.
     * @param item A feed item.
     * @returns Return either a link to the item, or null.
     */
    private static parseLinkFromItem(item: {guid?: string, link?: string}) {
        if (item.link) {
            return item.link;
        }
        if (item.guid) {
            try {
                // Technically we should be checking isPermaLink but 
                const url = new URL(item.guid);
                return url.toString();
            } catch (ex) {
                return null;
            }
        }
        return null;
    }

    private readonly parser = FeedReader.buildParser();

    private connections: FeedConnection[];
    // ts should notice that we do in fact initialize it in constructor, but it doesn't (in this version)
    private observedFeedUrls: Set<string> = new Set();

    private feedQueue: string[] = [];

    private seenEntries: Map<string, string[]> = new Map();
    // A set of last modified times for each url.
    private cacheTimes: Map<string, { etag?: string, lastModified?: string}> = new Map();
    
    // Reason failures to url map.
    private feedsFailingHttp = new Set();
    private feedsFailingParsing = new Set();

    static readonly seenEntriesEventType = "uk.half-shot.matrix-hookshot.feed.reader.seenEntries";

    private shouldRun = true;
    private timeout?: NodeJS.Timeout;

    get sleepingInterval() {
        return (this.config.pollIntervalSeconds * 1000) / (this.feedQueue.length || 1);
    }

    constructor(
        private readonly config: BridgeConfigFeeds,
        private readonly connectionManager: ConnectionManager,
        private readonly queue: MessageQueue,
        private readonly matrixClient: MatrixClient,
    ) {
        this.connections = this.connectionManager.getAllConnectionsOfType(FeedConnection);
        this.calculateFeedUrls();
        connectionManager.on('new-connection', c => {
            if (c instanceof FeedConnection) {
                log.debug('New connection tracked:', c.connectionId);
                this.connections.push(c);
                this.calculateFeedUrls();
            }
        });
        connectionManager.on('connection-removed', removed => {
            if (removed instanceof FeedConnection) {
                this.connections = this.connections.filter(c => c.connectionId !== removed.connectionId);
                this.calculateFeedUrls();
            }
        });

        log.debug('Loaded feed URLs:', this.observedFeedUrls);

        void this.loadSeenEntries().then(() => {
            return this.pollFeeds();
        });
    }

    public stop() {
        clearTimeout(this.timeout);
        this.shouldRun = false;
    }

    private calculateFeedUrls(): void {
        // just in case we got an invalid URL somehow
        const normalizedUrls = [];
        for (const conn of this.connections) {
            try {
                normalizedUrls.push(normalizeUrl(conn.feedUrl));
            } catch (err: unknown) {
                log.error(`Invalid feedUrl for connection ${conn.connectionId}: ${conn.feedUrl}. It will not be tracked`);
            }
        }
        this.observedFeedUrls = new Set(normalizedUrls);
        this.feedQueue = shuffle([...this.observedFeedUrls.values()]);

        Metrics.feedsCount.set(this.observedFeedUrls.size);
    }

    private async loadSeenEntries(): Promise<void> {
        try {
            const accountData = await this.matrixClient.getAccountData<AccountData>(FeedReader.seenEntriesEventType).catch((err: MatrixError|unknown) => {
                if (err instanceof MatrixError && err.statusCode === 404) {
                    return {} as AccountData;
                } else {
                    throw err;
                }
            });
            if (!validateAccountData(accountData)) {
                const errors = validateAccountData.errors?.map(e => `${e.instancePath} ${e.message}`) || ['No error reported'];
                throw new Error(`Invalid account data: ${errors.join(', ')}`);
            }
            for (const url in accountData) {
                this.seenEntries.set(url, accountData[url]);
            }
        } catch (err: unknown) {
            log.error(`Failed to load seen feed entries from accountData: ${err}. This may result in skipped entries`);
            // no need to wipe it manually, next saveSeenEntries() will make it right
        }
    }

    private async saveSeenEntries(): Promise<void> {
        const accountData: AccountData = {};
        for (const [url, guids] of this.seenEntries.entries()) {
            accountData[url.toString()] = guids;
        }
        await this.matrixClient.setAccountData(FeedReader.seenEntriesEventType, accountData);
    }

    /**
     * Poll a given feed URL for data, pushing any entries found into the message queue.
     * We also check the `cacheTimes` cache to see if the feed has recent entries that we can
     * filter out.
     * 
     * @param url The URL to be polled.
     * @returns A boolean that returns if we saw any changes on the feed since the last poll time.
     */
    private async pollFeed(url: string): Promise<boolean> {
        let seenEntriesChanged = false;
        const fetchKey = randomUUID();
        const { etag, lastModified } = this.cacheTimes.get(url) || {};
        log.debug(`Checking for updates in ${url} (${etag ?? lastModified})`);
        try {
            const { response, feed } = await FeedReader.fetchFeed(
                url,
                {
                    ...(lastModified && { 'If-Modified-Since': lastModified}),
                    ...(etag && { 'If-None-Match': etag}),
                },
                // We don't want to wait forever for the feed.
                this.config.pollTimeoutSeconds * 1000,
                this.parser,
            );
            
            // Store any entity tags/cache times.
            if (response.headers.ETag) {
                this.cacheTimes.set(url, { etag: response.headers.ETag});
            } else if (response.headers['Last-Modified']) {
                this.cacheTimes.set(url, { lastModified: response.headers['Last-Modified'] });
            }

            let initialSync = false;
            let seenGuids = this.seenEntries.get(url);
            if (!seenGuids) {
                initialSync = true;
                seenGuids = [];
                seenEntriesChanged = true; // to ensure we only treat it as an initialSync once
            }

            // migrate legacy, cleartext guids to their md5-hashed counterparts
            seenGuids = seenGuids.map(guid => guid.startsWith('md5:') ? guid : this.hashGuid(guid));

            const seenGuidsSet = new Set(seenGuids);
            const newGuids = [];
            log.debug(`Found ${feed.items.length} entries in ${url}`);

            for (const item of feed.items) {
                // Find the first guid-like that looks like a string.
                // Some feeds have a nasty habit of leading a empty tag there, making us parse it as garbage.
                const guid = [item.guid, item.id, item.link, item.title].find(id => typeof id === 'string' && id);
                if (!guid) {
                    log.error(`Could not determine guid for entry in ${url}, skipping`);
                    continue;
                }
                const hashedGuid = this.hashGuid(guid);
                newGuids.push(hashedGuid);

                if (initialSync) {
                    log.debug(`Skipping entry ${guid} since we're performing an initial sync`);
                    continue;
                }
                if (seenGuidsSet.has(hashedGuid)) {
                    log.debug('Skipping already seen entry', guid);
                    continue;
                }

                // The feed librray doesn't give us attributes, so we're not really sure if this a URL or not.
                // https://validator.w3.org/feed/docs/rss2.html#ltguidgtSubelementOfLtitemgt


                const entry = {
                    feed: {
                        title: feed.title ? stripHtml(feed.title) : null,
                        url: url,
                    },
                    title: item.title ? stripHtml(item.title) : null,
                    link: FeedReader.parseLinkFromItem(item),
                    fetchKey
                };

                log.debug('New entry:', entry);
                seenEntriesChanged = true;

                this.queue.push<FeedEntry>({ eventName: 'feed.entry', sender: 'FeedReader', data: entry });
            }

            if (seenEntriesChanged) {
                // Some RSS feeds can return a very small number of items then bounce
                // back to their "normal" size, so we cannot just clobber the recent GUID list per request or else we'll
                // forget what we sent and resend it. Instead, we'll keep 2x the max number of items that we've ever
                // seen from this feed, up to a max of 10,000. 
                // Adopted from https://github.com/matrix-org/go-neb/blob/babb74fa729882d7265ff507b09080e732d060ae/services/rssbot/rssbot.go#L304
                const maxGuids = Math.min(Math.max(2 * newGuids.length, seenGuids.length), 10_000);
                const newSeenItems = Array.from(new Set([ ...newGuids, ...seenGuids ]).values()).slice(0, maxGuids);
                this.seenEntries.set(url, newSeenItems);
            }
            this.queue.push<FeedSuccess>({ eventName: 'feed.success', sender: 'FeedReader', data: { url: url } });
            // Clear any feed failures
            this.feedsFailingHttp.delete(url);
            this.feedsFailingParsing.delete(url);
        } catch (err: unknown) {
            if (axios.isAxiosError(err)) {
                // No new feed items, skip.
                if (err.response?.status === StatusCodes.NOT_MODIFIED) {
                    return false;
                }
                this.feedsFailingHttp.add(url);
            } else {
                this.feedsFailingParsing.add(url);
            }
            const error = err instanceof Error ? err : new Error(`Unknown error ${err}`);
            const feedError = new FeedError(url.toString(), error, fetchKey);
            log.error("Unable to read feed:", feedError.message);
            this.queue.push<FeedError>({ eventName: 'feed.error', sender: 'FeedReader', data: feedError});
        } finally {
            this.feedQueue.push(url);
        }
        return seenEntriesChanged;
    }

    private async pollFeeds(): Promise<void> {
        log.debug(`Checking for updates in ${this.observedFeedUrls.size} RSS/Atom feeds`);

        const fetchingStarted = Date.now();

        const [ url ] = this.feedQueue.splice(0, 1);

        if (url) {
            if (await this.pollFeed(url)) {
                await this.saveSeenEntries();
            }
        }

        Metrics.feedsFailing.set({ reason: "http" }, this.feedsFailingHttp.size );
        Metrics.feedsFailing.set({ reason: "parsing" }, this.feedsFailingParsing.size);

        const elapsed = Date.now() - fetchingStarted;
        Metrics.feedFetchMs.set(elapsed);

        const sleepFor = Math.max(this.sleepingInterval - elapsed, 0);
        log.debug(`Feed fetching took ${elapsed / 1000}s, sleeping for ${sleepFor / 1000}s`);

        if (elapsed > this.sleepingInterval) {
            log.warn(`It took us longer to update the feeds than the configured pool interval`);
        }

        this.timeout = setTimeout(() => {
            if (!this.shouldRun) {
                return;
            }
            void this.pollFeeds();
        }, sleepFor);
    }

    private hashGuid(guid: string): string {
        return `md5:${FormatUtil.hashId(guid)}`;
    }
}
