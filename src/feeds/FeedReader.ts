import { BridgeConfigFeeds } from "../config/Config";
import { ConnectionManager } from "../ConnectionManager";
import { FeedConnection } from "../Connections";
import { Logger } from "matrix-appservice-bridge";
import { MessageQueue } from "../MessageQueue";
import axios from "axios";
import Metrics from "../Metrics";
import { randomUUID } from "crypto";
import { readFeed } from "../libRs";
import { IBridgeStorageProvider } from "../Stores/StorageProvider";
import UserAgent from "../UserAgent";
import { QueueWithBackoff } from "../libRs";

const log = new Logger("FeedReader");

const BACKOFF_TIME_MAX_MS = 24 * 60 * 60 * 1000;
const BACKOFF_POW = 1.05;
const BACKOFF_TIME_MS = 5 * 1000;

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

export class FeedReader {

    private connections: FeedConnection[];

    /**
     * Poll [1] every time.
     * Poll [2] every 4th time.
     * Poll [3] every 8th time.
     * Poll [4] every 16th time.
     * 
     * Every N hours, move between buckets.
     */

    private readonly intakeBucket = new QueueWithBackoff(BACKOFF_TIME_MS, BACKOFF_POW, BACKOFF_TIME_MAX_MS);

    // TODO: Make this configurable.
    private readonly feedBuckets = new Map([
        [0, this.intakeBucket], // < feedInterval
        [4, new QueueWithBackoff(BACKOFF_TIME_MS, BACKOFF_POW, BACKOFF_TIME_MAX_MS)], // < 4xfeedInvterval
        [8, new QueueWithBackoff(BACKOFF_TIME_MS, BACKOFF_POW, BACKOFF_TIME_MAX_MS)], // < 8xfeedInvterval
        [16, new QueueWithBackoff(BACKOFF_TIME_MS, BACKOFF_POW, BACKOFF_TIME_MAX_MS)], // rest
    ]);
    private readonly lastBucket = 16;
    private bucketIteration = 0;


    // A set of last modified times for each url.
    private readonly cacheTimes: Map<string, { etag?: string, lastModified?: string}> = new Map();

    // Reason failures to url map.
    private readonly feedsFailingHttp = new Set();
    private readonly feedsFailingParsing = new Set();

    static readonly seenEntriesEventType = "uk.half-shot.matrix-hookshot.feed.reader.seenEntries";

    private shouldRun = true;
    private readonly timeouts: (NodeJS.Timeout|undefined)[];
    private readonly feedsToRetain = new Set();

    get feedCount() {
        return Object.values(this.feedBuckets).map(b => b.length()).reduce((a,b) => a+b, 0);
    }

    get sleepingInterval() {
        return (
            // Calculate the number of MS to wait in between feeds.
            (this.config.pollIntervalSeconds * 1000) / (this.feedCount || 1)
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
        const feeds = this.calculateInitialFeedUrls();
        connectionManager.on('new-connection', newConnection => {
            if (!(newConnection instanceof FeedConnection)) {
                return;
            }
            const normalisedUrl = normalizeUrl(newConnection.feedUrl);
            if (!feeds.has(normalisedUrl)) {
                log.info(`Connection added, adding "${normalisedUrl}" to queue`);
                this.intakeBucket.push(normalisedUrl);
                feeds.add(normalisedUrl);
                Metrics.feedsCount.inc();
                Metrics.feedsCountDeprecated.inc();
            }
        });
        connectionManager.on('connection-removed', removed => {
            if (!(removed instanceof FeedConnection)) {
                return;
            }
            let shouldKeepUrl = false;
            const normalisedUrl = normalizeUrl(removed.feedUrl);
            this.connections = this.connections.filter(c => {
                // Cheeky reuse of iteration to determine if we should remove this URL.
                if (c.connectionId !== removed.connectionId) {
                    shouldKeepUrl = shouldKeepUrl || normalizeUrl(c.feedUrl) === normalisedUrl;
                    return true;
                }
                return false;
            });
            if (shouldKeepUrl) {
                log.info(`Connection removed, but not removing "${normalisedUrl}" as it is still in use`);
                return;
            }
            log.info(`Connection removed, removing "${normalisedUrl}" from queue`);
            this.feedsToRetain.delete(normalisedUrl);
            Object.values(this.feedBuckets).some(bucket => bucket.remove(normalisedUrl));
            feeds.delete(normalisedUrl);
            this.feedsFailingHttp.delete(normalisedUrl);
            this.feedsFailingParsing.delete(normalisedUrl);
            Metrics.feedsCount.dec();
            Metrics.feedsCountDeprecated.dec();
        });

        log.debug('Loaded feed URLs:', [...feeds].join(', '));

        for (let i = 0; i < config.pollConcurrency; i++) {
            void this.pollFeeds(i);
        }

        this.configureBucketInterval();
    }

    /**
     * Resort feeds into the correct queues based on how
     * often they return new values.
     */
    public configureBucketInterval() {
        // TOOD: Run this function on startup to immediate sort into buckets.
        const bucketEntries = [...this.feedBuckets.entries()];
        setInterval(async () => {
            const { scores, lastQueryTime } = await this.storage.resetFeedQueryCount();
            if (lastQueryTime === 0) {
                log.debug(`Skipping first bucket interval check, not enough data present.`);
                // Skip, not enough data.
                return;
            }
            const timePassed = Date.now() - lastQueryTime;
            // Determine a reasonable approximation of how much the feed may have been polled in the 
            // last time period.
            const maximumFastestPotential = timePassed / this.sleepingInterval;
            // TODO: This should be all feeds, so we can catch any that don't even score...
            for (const [url, pollCount] of Object.entries(scores)) {
                // Remove current bucket
                const feedCurrentBucket = bucketEntries.find((b) => b[1].remove(url));
                if (!feedCurrentBucket) {
                    log.warn(`Feed ${url} was not found in any buckets!!!`);
                    continue;
                }
                // E.g. Bucket 1 polls only 4 times as often as bucket 0, so we want to ensure we weight these fairly.
                const maximumPotential = maximumFastestPotential * (1 / (feedCurrentBucket[0] || 1));
                log.debug(`Determining new bucket for ${url}. Maximum possible poll rate would be ${maximumPotential}. Score was ${pollCount}`);

                // Determine new bucket
                for (let bIndex = 0; bIndex < bucketEntries.length; bIndex++) {
                    const currentBucket = bucketEntries[bIndex];
                    const nextBucket = bucketEntries[bIndex+1];
                    if (!nextBucket) {
                        // We're at the end, just push to the last bucket because this is a sad feed that didn't 
                        // get any items.
                        currentBucket[1].push(url);
                        break;
                    }
                    // ((16 - (4 / 16)) / 16)*50 
                    const nextBucketMinSuccessRate = (1 - (nextBucket[0] / this.lastBucket))*maximumPotential;
                    log.debug(`Min success rate target for bucket ${nextBucket[0]} is ${nextBucketMinSuccessRate}`);
                    if (pollCount >= nextBucketMinSuccessRate) {
                        log.debug(`Adding feed ${url} to ${currentBucket[0]}`);
                        currentBucket[1].push(url);
                        break;
                    }
                }
            }
        }, 30000);
    }

    public stop() {
        this.shouldRun = false;
        this.timeouts.forEach(t => clearTimeout(t));
    }

    /**
     * Calculate the initial feed set for the reader. Should never
     * be called twice.
     */
    private calculateInitialFeedUrls(): Set<string> {
        // just in case we got an invalid URL somehow
        const observedFeedUrls = new Set<string>();
        for (const conn of this.connections) {
            try {
                observedFeedUrls.add(normalizeUrl(conn.feedUrl));
            } catch (err: unknown) {
                log.error(`Invalid feedUrl for connection ${conn.connectionId}: ${conn.feedUrl}. It will not be tracked`);
            }
        }
        this.intakeBucket.populate([...observedFeedUrls]);
        Metrics.feedsCount.set(observedFeedUrls.size);
        Metrics.feedsCountDeprecated.set(observedFeedUrls.size);
        return observedFeedUrls;
    }

    /**
     * Poll a given feed URL for data, pushing any entries found into the message queue.
     * We also check the `cacheTimes` cache to see if the feed has recent entries that we can
     * filter out.
     *
     * @param url The URL to be polled.
     * @returns A boolean that returns if we saw any changes on the feed since the last poll time.
     */
    public async pollFeed(url: string, feedQueue: QueueWithBackoff): Promise<boolean> {
        // If a feed is deleted while it is being polled, we need
        // to remember NOT to add it back to the queue. This
        // set keeps track of all the feeds that *should* be
        // requeued.
        this.feedsToRetain.add(url);
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
                const seenItems = await this.storage.hasSeenFeedGuids(url, ...feed.items.filter(item => !!item.hashId).map(item => item.hashId!))
                log.debug(`Seen ${seenItems.join(', ')} entries for ${url} already`);
                for (const item of feed.items) {
                    // Some feeds have a nasty habit of leading a empty tag there, making us parse it as garbage.
                    if (!item.hashId) {
                        log.error(`Could not determine guid for entry in ${url}, skipping`);
                        continue;
                    }
                    if (seenItems.includes(item.hashId)) {
                        continue;
                    }
                    newGuids.push(item.hashId);
    
                    if (initialSync) {
                        log.debug(`Skipping entry ${item.id ?? item.hashId} since we're performing an initial sync`);
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
    
                if (seenEntriesChanged && newGuids.length) {
                    await this.storage.storeFeedGuids(url, ...newGuids);
                }
            }
            this.queue.push<FeedSuccess>({ eventName: 'feed.success', sender: 'FeedReader', data: { url } });
            // Clear any feed failures
            this.feedsFailingHttp.delete(url);
            this.feedsFailingParsing.delete(url);
            if (this.feedsToRetain.has(url)) {
                // If we've removed this feed since processing it, do not requeue.
                feedQueue.push(url);
            }
        } catch (err: unknown) {
            // TODO: Proper Rust Type error.
            if ((err as Error).message.includes('Failed to fetch feed due to HTTP')) {
                this.feedsFailingHttp.add(url);
            } else {
                this.feedsFailingParsing.add(url);
            }
            const backoffDuration = feedQueue.backoff(url);
            const error = err instanceof Error ? err : new Error(`Unknown error ${err}`);
            const feedError = new FeedError(url.toString(), error, fetchKey);
            log.error("Unable to read feed:", feedError.message, `backing off for ${backoffDuration}ms`);
            this.queue.push<FeedError>({ eventName: 'feed.error', sender: 'FeedReader', data: feedError});
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

        log.debug(`Checking for updates in ${this.feedCount} RSS/Atom feeds (worker: ${workerId})`);

        // TODO: Dehardcode
        if (this.bucketIteration > this.lastBucket) {
            this.bucketIteration = 0;
        }
        this.bucketIteration++;
        const queuesToPoll = [...this.feedBuckets.entries()].filter(([bucketInterval]) => bucketInterval % this.bucketIteration === 0);

        const fetchingStarted = Date.now();

        let sleepFor = 0;
        for (const [queueNumber, queue] of queuesToPoll) {
            log.debug(`Fetching from queue ${queueNumber}`);
            const url = queue.pop();
            if (url) {
                if (await this.pollFeed(url, queue)) {
                    log.debug(`Feed changed and will be saved`);
                }
                const elapsed = Date.now() - fetchingStarted;
                log.debug(`Feed fetching took ${elapsed / 1000}s,`);
                Metrics.feedFetchMs.set(elapsed);
                Metrics.feedsFetchMsDeprecated.set(elapsed);
                sleepFor += Math.max(this.sleepingInterval - elapsed, 0);
            } else {
                // It is possible that we have more workers than feeds. This will cause the worker to just sleep.
                log.debug(`No feeds available to poll for worker ${workerId} on this bucket`);
                // So we don't tightloop
                if (sleepFor === 0) {
                    sleepFor += this.sleepingInterval;
                }
            }
        }

        if (this.sleepingInterval === 0) {
            log.warn(`It took us longer to update the feeds than the configured pool interval`);
        } else {
            log.debug(`Sleeping for ${sleepFor / 1000}s`);
        }

        this.timeouts[workerId] = setTimeout(() => {
            if (!this.shouldRun) {
                return;
            }
            void this.pollFeeds(workerId);
        }, sleepFor);
    }
}
