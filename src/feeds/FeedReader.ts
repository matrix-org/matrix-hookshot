import { MatrixClient } from "matrix-bot-sdk";
import { BridgeConfigFeeds } from "../Config/Config";
import { ConnectionManager } from "../ConnectionManager";
import { FeedConnection } from "../Connections";
import LogWrapper from "../LogWrapper";
import { MessageQueue } from "../MessageQueue";

import Ajv from "ajv";
import axios from "axios";
import Parser from "rss-parser";

const log = new LogWrapper("FeedReader");

export class FeedError extends Error {
    constructor(
        public url: string,
        public cause: Error,
    ) {
        super(`Error fetching feed ${url}: ${cause.message}`);
    }
}

export interface FeedEntry {
    feed: {
        title: string,
        url:   string,
    },
    title: string,
    link:  string,
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

export class FeedReader {
    private observedFeedUrls: string[];
    private seenEntries: Map<string, string[]> = new Map();
    static readonly seenEntriesEventType = "uk.half-shot.matrix-hookshot.feed.reader.seenEntries";

    constructor(
        private config: BridgeConfigFeeds,
        private connectionManager: ConnectionManager,
        private queue: MessageQueue,
        private matrixClient: MatrixClient,
    ) {
        const feedConnections = this.connectionManager.getAllConnectionsOfType(FeedConnection);
        this.observedFeedUrls = feedConnections.map(c => c.feedUrl);
        connectionManager.on('new-connection', c => {
            if (c instanceof FeedConnection) {
                log.info('New connection tracked:', c.feedUrl);
                this.observedFeedUrls.push(c.feedUrl);
            }
        });

        log.info('Loaded feed URLs:', this.observedFeedUrls);

        void this.loadSeenEntries().then(() => {
            return this.pollFeeds();
        });
    }

    private async loadSeenEntries(): Promise<void> {
        try {
            const accountData = await this.matrixClient.getAccountData<any>(FeedReader.seenEntriesEventType).catch((err: any) => {
                if (err.statusCode === 404) {
                    return {};
                } else {
                    throw err;
                }
            });
            if (!validateAccountData(accountData)) {
                const errors = validateAccountData.errors!.map(e => `${e.instancePath} ${e.message}`);
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

    private async pollFeeds(): Promise<void> {
        log.debug(`Checking for updates in ${this.observedFeedUrls.length} RSS/Atom feeds`);

        let seenEntriesChanged = false;

        const fetchingStarted = (new Date()).getTime();

        for (const url of this.observedFeedUrls) {
            try {
                const res = await axios.get(url.toString());
                const feed = await (new Parser()).parseString(res.data);
                const seenGuids = this.seenEntries.get(url) || [];
                const seenGuidsSet = new Set(seenGuids);
                let initialSync = false;
                if (seenGuidsSet.size === 0) {
                    initialSync = true;
                }
                const newGuids = [];
                log.debug(`Found ${feed.items.length} entries in ${url}`);
                for (const item of feed.items) {
                    const guid = item.guid || item.id || item.link || item.title;
                    if (!guid) {
                        log.error(`Could not determine guid for entry in ${url}, skipping`);
                        continue;
                    }
                    newGuids.push(guid);

                    if (initialSync) {
                        log.debug(`Skipping entry ${guid} since we're performing an initial sync`);
                        continue;
                    }
                    if (seenGuidsSet.has(guid)) {
                        log.debug('Skipping already seen entry', guid);
                        continue;
                    }

                    const entry = {
                        feed: { title: stripHtml(feed.title!), url: url.toString() },
                        title: stripHtml(item.title!),
                        link: item.link!,
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
            } catch (err: any) {
                const error = new FeedError(url.toString(), err);
                log.error(error.message);
                this.queue.push<FeedError>({ eventName: 'feed.error', sender: 'FeedReader', data: error });
            }
        }
        if (seenEntriesChanged) await this.saveSeenEntries();

        const elapsed = (new Date()).getTime() - fetchingStarted;

        let sleepFor: number;
        if (elapsed > this.config.pollIntervalSeconds * 1000) {
            log.warn(`It tooks us longer to update the feeds than the configured pool interval (${elapsed / 1000}s)`);
            sleepFor = 0;
        } else {
            sleepFor = this.config.pollIntervalSeconds * 1000 - elapsed;
            log.debug(`Feed fetching took ${elapsed / 1000}s, sleeping for ${sleepFor / 1000}s`);
        }

        setTimeout(() => {
            void this.pollFeeds();
        }, sleepFor);
    }
}
