import axios from "axios";
import { ConnectionManager } from "../ConnectionManager";
import { HoundConnection, HoundPayload, IActivity } from "../Connections/ChallengeHound";
import { MessageQueue } from "../MessageQueue";
import { IBridgeStorageProvider } from "../Stores/StorageProvider";
import { BridgeConfigChallengeHound } from "../config/Config";
import { Logger } from "matrix-appservice-bridge";

function normalizeUrl(input: string): string {
    const url = new URL(input);
    url.hash = '';
    return url.toString();
}

const log = new Logger("HoundReader");

export class HoundReader {
    private connections: HoundConnection[];
    private urls: string[];
    private timeout?: NodeJS.Timeout;
    private shouldRun = true;
    private readonly houndClient: axios.AxiosInstance;

    get sleepingInterval() {
        return 60000;
    }

    constructor(
        config: BridgeConfigChallengeHound,
        private readonly connectionManager: ConnectionManager,
        private readonly queue: MessageQueue,
        private readonly storage: IBridgeStorageProvider,
    ) {
        this.connections = this.connectionManager.getAllConnectionsOfType(HoundConnection);
        this.urls = this.connections.map(c => normalizeUrl(c.url));
        this.houndClient = axios.create({
            headers: {
                'Authorization': config.token,
            }
        });

        connectionManager.on('new-connection', newConnection => {
            if (!(newConnection instanceof HoundConnection)) {
                return;
            }
            const normalisedUrl = normalizeUrl(newConnection.url);
            if (!this.urls.includes(normalisedUrl)) {
                log.info(`Connection added, adding "${normalisedUrl}" to queue`);
                this.urls.push(normalisedUrl);
            }
        });
        connectionManager.on('connection-removed', removed => {
            if (!(removed instanceof HoundConnection)) {
                return;
            }
            let shouldKeepUrl = false;
            const normalisedUrl = normalizeUrl(removed.url);
            this.connections = this.connections.filter(c => {
                // Cheeky reuse of iteration to determine if we should remove this URL.
                if (c.connectionId !== removed.connectionId) {
                    shouldKeepUrl = shouldKeepUrl || normalizeUrl(c.url) === normalisedUrl;
                    return true;
                }
                return false;
            });
            if (shouldKeepUrl) {
                log.info(`Connection removed, but not removing "${normalisedUrl}" as it is still in use`);
                return;
            }
            log.info(`Connection removed, removing "${normalisedUrl}" from queue`);
            this.urls = this.urls.filter(u => u !== removed.url)
        });

        log.debug('Loaded activity URLs:', [...this.urls].join(', '));
    }

    public stop() {
        this.shouldRun = false;
        if (this.timeout) {
            clearTimeout(this.timeout);
        }
    }

    public async poll(url: string) {
        const resAct = await this.houndClient.get(`${url}/activities?limit=10`);
        const activites = resAct.data as IActivity[];
        const seen = await this.storage.hasSeenHoundActivity(url, ...activites.map(a => a.id));
        for (const activity of activites) {
            if (seen.includes(activity.id)) {
                continue;
            }
            this.queue.push<HoundPayload>({
                eventName: "hound.activity", 
                sender: "HoundReader",
                data: {
                    url,
                    activity: activity,
                }
            });
        }
        await this.storage.storeHoundActivity(url, ...activites.map(a => a.id))
    }

    public async pollFeeds(): Promise<void> {
        log.debug(`Checking for updates`);

        const fetchingStarted = Date.now();

        const url = this.urls.pop();
        let sleepFor = this.sleepingInterval;

        if (url) {
            try {
                await this.poll(url);
                const elapsed = Date.now() - fetchingStarted;
                sleepFor = Math.max(this.sleepingInterval - elapsed, 0);
                log.debug(`Feed fetching took ${elapsed / 1000}s, sleeping for ${sleepFor / 1000}s`);

                if (elapsed > this.sleepingInterval) {
                    log.warn(`It took us longer to update the feeds than the configured pool interval`);
                }
            } finally {
                this.urls.splice(0, 0, url);
            }
        } else {
            // It is possible that we have more workers than feeds. This will cause the worker to just sleep.
            log.debug(`No activites available to poll`);
        }

        this.timeout = setTimeout(() => {
            if (!this.shouldRun) {
                return;
            }
            void this.pollFeeds();
        }, sleepFor);
    }
}