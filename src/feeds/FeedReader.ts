import { MatrixError } from "matrix-bot-sdk";
import { BridgeConfigFeeds } from "../config/Config";
import { ConnectionManager } from "../ConnectionManager";
import { FeedConnection } from "../Connections";
import { Logger } from "matrix-appservice-bridge";
import { MessageQueue } from "../MessageQueue";
import Ajv from "ajv";
import axios, { AxiosResponse } from "axios";
import Metrics from "../Metrics";
import UserAgent from "../UserAgent";
import { randomUUID } from "crypto";
import { StatusCodes } from "http-status-codes";
import { JsRssChannel, parseFeed } from "../libRs";
import { IBridgeStorageProvider } from "../Stores/StorageProvider";

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
    pubdate: string|null,
    summary: string|null,
    author: string|null,
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

interface AccountDataStore {
    getAccountData<T>(type: string): Promise<T>;
    setAccountData<T>(type: string, data: T): Promise<void>;
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

function isNonEmptyString(input: unknown): input is string {
    return Boolean(input) && typeof input === 'string';
}

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

export class FeedReader {
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
        httpClient = axios,
    ): Promise<{ response: AxiosResponse, feed: JsRssChannel }> {
        const response = await httpClient.get(url, {
            headers: {
                'User-Agent': UserAgent,
                ...headers,
            },
            // We don't want to wait forever for the feed.
            timeout: timeoutMs,
        });
        
        if (typeof response.data !== "string") {
            throw Error('Unexpected response type');
        }
        const feed = parseFeed(response.data);
        return { response, feed };  
    }

    private connections: FeedConnection[];
    // ts should notice that we do in fact initialize it in constructor, but it doesn't (in this version)
    private observedFeedUrls: Set<string> = new Set();

    private feedQueue: string[] = [];

    // A set of last modified times for each url.
    private cacheTimes: Map<string, { etag?: string, lastModified?: string}> = new Map();

    // Reason failures to url map.
    private feedsFailingHttp = new Set();
    private feedsFailingParsing = new Set();

    static readonly seenEntriesEventType = "uk.half-shot.matrix-hookshot.feed.reader.seenEntries";

    private shouldRun = true;
    private readonly timeouts: NodeJS.Timeout[] = [];
    private readonly accountDataPeriodicSave: NodeJS.Timer;

    get sleepingInterval() {
        return (this.config.pollIntervalSeconds * 1000) / (this.feedQueue.length || 1);
    }

    constructor(
        private readonly config: BridgeConfigFeeds,
        private readonly connectionManager: ConnectionManager,
        private readonly queue: MessageQueue,
        private readonly storage: IBridgeStorageProvider,
        private readonly accountDataStore: AccountDataStore,
        private readonly httpClient = axios,
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
            for (let i = 0; i < config.pollConcurrency; i++) {
                void this.pollFeeds(i);
            }
        });
        this.accountDataPeriodicSave = setInterval(() => {
            void this.saveSeenEntries();
        }, 300*1000);
    }

    public stop() {
        this.shouldRun = false;
        this.timeouts.forEach(t => clearTimeout(t));
        clearInterval(this.accountDataPeriodicSave);
        this.saveSeenEntries();
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
        Metrics.feedsCountDeprecated.set(this.observedFeedUrls.size);
    }

    private async loadSeenEntries(): Promise<void> {
        try {
            const accountData = await this.accountDataStore.getAccountData<AccountData>(FeedReader.seenEntriesEventType).catch((err: MatrixError|unknown) => {
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
            await this.storage.storeAllFeedGuids(accountData);
        } catch (err: unknown) {
            log.error(`Failed to load seen feed entries from accountData: ${err}. This may result in skipped entries`);
            // no need to wipe it manually, next saveSeenEntries() will make it right
        }
    }

    private async saveSeenEntries(): Promise<void> {
        log.debug(`Saving seen entries`);
        const accountData: AccountData = await this.storage.getAllFeedGuids([...this.observedFeedUrls]);
        await this.accountDataStore.setAccountData(FeedReader.seenEntriesEventType, accountData);
    }

    /**
     * Poll a given feed URL for data, pushing any entries found into the message queue.
     * We also check the `cacheTimes` cache to see if the feed has recent entries that we can
     * filter out.
     *
     * @param url The URL to be polled.
     * @returns A boolean that returns if we saw any changes on the feed since the last poll time.
     */
    public async pollFeed(url: string): Promise<boolean> {
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
                this.httpClient,
            );

            // Store any entity tags/cache times.
            if (response.headers.ETag) {
                this.cacheTimes.set(url, { etag: response.headers.ETag});
            } else if (response.headers['Last-Modified']) {
                this.cacheTimes.set(url, { lastModified: response.headers['Last-Modified'] });
            }

            let initialSync = false;
            if (!await this.storage.hasSeenFeed(url)) {
                initialSync = true;
                seenEntriesChanged = true; // to ensure we only treat it as an initialSync once
            }

            // migrate legacy, cleartext guids to their md5-hashed counterparts
            const newGuids = [];
            log.debug(`Found ${feed.items.length} entries in ${url}`);

            for (const item of feed.items) {
                // Find the first guid-like that looks like a string.
                // Some feeds have a nasty habit of leading a empty tag there, making us parse it as garbage.
                if (!item.hashId) {
                    log.error(`Could not determine guid for entry in ${url}, skipping`);
                    continue;
                }
                const hashId = `md5:${item.hashId}`;
                newGuids.push(hashId);

                if (initialSync) {
                    log.debug(`Skipping entry ${item.id ?? hashId} since we're performing an initial sync`);
                    continue;
                }
                if (await this.storage.hasSeenFeedGuid(url, hashId)) {
                    log.debug('Skipping already seen entry', item.id ?? hashId);
                    continue;
                }
                const entry = {
                    feed: {
                        title: isNonEmptyString(feed.title) ? stripHtml(feed.title) : null,
                        url: url,
                    },
                    title: isNonEmptyString(item.title) ? stripHtml(item.title) : null,
                    pubdate: item.pubdate ?? null,
                    summary: item.summary ?? null,
                    author: item.author ?? null,
                    link: item.link ?? null,
                    fetchKey
                };

                log.debug('New entry:', entry);
                seenEntriesChanged = true;

                this.queue.push<FeedEntry>({ eventName: 'feed.entry', sender: 'FeedReader', data: entry });
            }

            if (seenEntriesChanged) {
                await this.storage.storeFeedGuid(url, ...newGuids);
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

    /**
     * Start polling all the feeds. 
     */
    public async pollFeeds(workerId: number): Promise<void> {

        // Update on each iteration
        Metrics.feedsFailing.set({ reason: "http" }, this.feedsFailingHttp.size );
        Metrics.feedsFailing.set({ reason: "parsing" }, this.feedsFailingParsing.size);
        Metrics.feedsFailingDeprecated.set({ reason: "http" }, this.feedsFailingHttp.size );
        Metrics.feedsFailingDeprecated.set({ reason: "parsing" }, this.feedsFailingParsing.size);

        log.debug(`Checking for updates in ${this.observedFeedUrls.size} RSS/Atom feeds (worker: ${workerId})`);

        const fetchingStarted = Date.now();

        const [ url ] = this.feedQueue.splice(0, 1);
        let sleepFor = this.sleepingInterval;

        if (url) {
            if (await this.pollFeed(url)) {
                log.debug(`Feed changed and will be saved`);
            }
            const elapsed = Date.now() - fetchingStarted;
            Metrics.feedFetchMs.set(elapsed);
            Metrics.feedsFetchMsDeprecated.set(elapsed);
            sleepFor = Math.max(this.sleepingInterval - elapsed, 0);
            log.debug(`Feed fetching took ${elapsed / 1000}s, sleeping for ${sleepFor / 1000}s`);
    
            if (elapsed > this.sleepingInterval) {
                log.warn(`It took us longer to update the feeds than the configured pool interval`);
            }
        } else {
            // It may be possible that we have more workers than feeds. This will cause the worker to just sleep.
            log.debug(`No feeds available to poll for worker ${workerId}`);
        }

        this.timeouts[workerId] = setTimeout(() => {
            if (!this.shouldRun) {
                return;
            }
            void this.pollFeeds(workerId);
        }, sleepFor);
    }
}
