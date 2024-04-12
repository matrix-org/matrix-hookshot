import axios from "axios";
import { ConnectionManager } from "../ConnectionManager";
import { HoundConnection, HoundPayload, HoundActivity } from "../Connections/HoundConnection";
import { MessageQueue } from "../MessageQueue";
import { IBridgeStorageProvider } from "../Stores/StorageProvider";
import { BridgeConfigChallengeHound } from "../config/Config";
import { Logger } from "matrix-appservice-bridge";

const log = new Logger("HoundReader");

export class HoundReader {
    private connections: HoundConnection[];
    private challengeIds: string[];
    private timeout?: NodeJS.Timeout;
    private shouldRun = true;
    private readonly houndClient: axios.AxiosInstance;

    get sleepingInterval() {
        return 60000 / (this.challengeIds.length || 1); 
    }

    constructor(
        config: BridgeConfigChallengeHound,
        private readonly connectionManager: ConnectionManager,
        private readonly queue: MessageQueue,
        private readonly storage: IBridgeStorageProvider,
    ) {
        this.connections = this.connectionManager.getAllConnectionsOfType(HoundConnection);
        this.challengeIds = this.connections.map(c => c.challengeId);
        this.houndClient = axios.create({
            headers: {
                'Authorization': config.token,
            }
        });

        connectionManager.on('new-connection', newConnection => {
            if (!(newConnection instanceof HoundConnection)) {
                return;
            }
            if (!this.challengeIds.includes(newConnection.challengeId)) {
                log.info(`Connection added, adding "${newConnection.challengeId}" to queue`);
                this.challengeIds.push(newConnection.challengeId);
            }
        });
        connectionManager.on('connection-removed', removed => {
            if (!(removed instanceof HoundConnection)) {
                return;
            }
            let shouldKeepUrl = false;
            this.connections = this.connections.filter(c => {
                // Cheeky reuse of iteration to determine if we should remove this URL.
                if (c.connectionId !== removed.connectionId) {
                    shouldKeepUrl = shouldKeepUrl || c.challengeId === removed.challengeId;
                    return true;
                }
                return false;
            });
            if (shouldKeepUrl) {
                log.info(`Connection removed, but not removing "${removed.challengeId}" as it is still in use`);
                return;
            }
            log.info(`Connection removed, removing "${removed.challengeId}" from queue`);
            this.challengeIds = this.challengeIds.filter(u => u !== removed.challengeId)
        });

        log.debug('Loaded challenge IDs:', [...this.challengeIds].join(', '));
        void this.pollChallenges();
    }

    public stop() {
        this.shouldRun = false;
        if (this.timeout) {
            clearTimeout(this.timeout);
        }
    }

    public async poll(challengeId: string) {
        const resAct = await this.houndClient.get(`https://api.challengehound.com/challenges/${challengeId}/activities?limit=10`);
        const activites = resAct.data as HoundActivity[];
        const seen = await this.storage.hasSeenHoundActivity(challengeId, ...activites.map(a => a.id));
        for (const activity of activites) {
            if (seen.includes(activity.id)) {
                continue;
            }
            this.queue.push<HoundPayload>({
                eventName: "hound.activity", 
                sender: "HoundReader",
                data: {
                    challengeId,
                    activity: activity,
                }
            });
        }
        await this.storage.storeHoundActivity(challengeId, ...activites.map(a => a.id))
    }

    public async pollChallenges(): Promise<void> {
        log.debug(`Checking for updates`);

        const fetchingStarted = Date.now();

        const challengeId = this.challengeIds.pop();
        let sleepFor = this.sleepingInterval;

        if (challengeId) {
            try {
                await this.poll(challengeId);
                const elapsed = Date.now() - fetchingStarted;
                sleepFor = Math.max(this.sleepingInterval - elapsed, 0);
                log.debug(`Activity fetching took ${elapsed / 1000}s, sleeping for ${sleepFor / 1000}s`);

                if (elapsed > this.sleepingInterval) {
                    log.warn(`It took us longer to update the activities than the expected interval`);
                }
            } finally {
                this.challengeIds.splice(0, 0, challengeId);
            }
        } else {
            log.debug(`No activites available to poll`);
        }

        this.timeout = setTimeout(() => {
            if (!this.shouldRun) {
                return;
            }
            void this.pollChallenges();
        }, sleepFor);
    }
}