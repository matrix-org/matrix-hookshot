import { BridgeConfigFeeds } from "../config/Config";
import { ConnectionManager } from "../ConnectionManager";
import { FeedConnection } from "../Connections";
import { Logger } from "matrix-appservice-bridge";
import { MessageQueue } from "../MessageQueue";
import axios from "axios";
import Metrics from "../Metrics";
import { randomUUID } from "crypto";
import { FeedItem, readFeed } from "../libRs";
import { IBridgeStorageProvider } from "../Stores/StorageProvider";
import UserAgent from "../UserAgent";

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
    private readonly timeouts: (NodeJS.Timeout|undefined)[];

    get sleepingInterval() {
        return (
            // Calculate the number of MS to wait in between feeds.
            (this.config.pollIntervalSeconds * 1000) / (this.feedQueue.length || 1)
            // And multiply by the number of concurrent readers
        ) * this.config.pollConcurrency;
    }

    constructor(
        private readonly config: BridgeConfigFeeds,
        private readonly connectionManager: ConnectionManager,
        private readonly queue: MessageQueue,
        private readonly storage: IBridgeStorageProvider,
    ) {
        // Ensure a fixed length array,
        this.timeouts = new Array(config.pollConcurrency);
        this.timeouts.fill(undefined);
        Object.seal(this.timeouts);
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

        for (let i = 0; i < config.pollConcurrency; i++) {
            void this.pollFeeds(i);
        }
    }

    public stop() {
        this.shouldRun = false;
        this.timeouts.forEach(t => clearTimeout(t));
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
            const result = await readFeed(url, {
                pollTimeoutSeconds: this.config.pollTimeoutSeconds,
                etag,
                lastModified,
                userAgent: UserAgent,
            });

            // Store any entity tags/cache times.
            if (result.etag) {
                this.cacheTimes.set(url, { etag: result.etag });
            } else if (result.lastModified) {
                this.cacheTimes.set(url, { lastModified: result.lastModified });
            }

            const { feed } = result;
            let initialSync = false;
            if (!await this.storage.hasSeenFeed(url)) {
                initialSync = true;
                seenEntriesChanged = true; // to ensure we only treat it as an initialSync once
            }

            const newGuids = [];
            if (feed) {
                // If undefined, we got a not-modified.
                log.debug(`Found ${feed.items.length} entries in ${url}`);

                const newEntries: FeedEntry[] = [];

                for (const item of feed.items) {
                    // Some feeds have a nasty habit of leading a empty tag there, making us parse it as garbage.
                    if (!item.hashId) {
                        log.error(`Could not determine guid for entry in ${url}, skipping`);
                        continue;
                    }
                    const hashId = `md5:${item.hashId}`;
                    newGuids.push(hashId);

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
                    newEntries.push(entry);
                    seenEntriesChanged = true;
                }
    
                if (initialSync) {
                    if (this.storage.isPersistent) {
                        try {
                            const latest = newEntries.sort((a, b) => new Date(b.pubdate!).getTime() - new Date(a.pubdate!).getTime())[0];
                            this.queue.push<FeedEntry>({ eventName: 'feed.entry', sender: 'FeedReader', data: latest });
                        } catch (err: unknown) {
                            // no pubdates available, or they parse incorrectly. Null sweat
                            log.debug(`Could not determine the latest entry in ${url} (${err}), won't report anything`);
                        }
                    }
                } else {
                    newEntries.forEach(entry => this.queue.push<FeedEntry>({ eventName: 'feed.entry', sender: 'FeedReader', data: entry }));
                }
    
                if (seenEntriesChanged && newGuids.length) {
                    await this.storage.storeFeedGuids(url, ...newGuids);
                }
    
            }
            this.queue.push<FeedSuccess>({ eventName: 'feed.success', sender: 'FeedReader', data: { url } });
            // Clear any feed failures
            this.feedsFailingHttp.delete(url);
            this.feedsFailingParsing.delete(url);
        } catch (err: unknown) {
            // TODO: Proper Rust Type error.
            if ((err as Error).message.includes('Failed to fetch feed due to HTTP')) {
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
