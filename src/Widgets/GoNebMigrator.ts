import { Logger } from "matrix-appservice-bridge";
import axios from "axios";

import { FeedConnection, FeedConnectionState } from "../Connections";

const log = new Logger("GoNebMigrator");

interface MigratedConnections {
    [FeedConnection.ServiceCategory]?: FeedConnectionState[]|undefined,
}

interface GoNebFeedsConfig {
    [url: string]: {
        rooms: string[],
    }
}

export class GoNebMigrator {
    constructor(
        private apiUrl: string,
        private serviceIds: string[],
    ) {}

    static convertFeeds(goNebFeeds: GoNebFeedsConfig): Map<string, FeedConnectionState[]> {
        const feedsPerRoom = new Map<string, FeedConnectionState[]>();

        for (const [url, config] of Object.entries(goNebFeeds)) {
            for (const roomId of config.rooms) {
                const existing = feedsPerRoom.get(roomId) ?? [];
                existing.push({ url });
                feedsPerRoom.set(roomId, existing);
            }
        }

        return feedsPerRoom;
    }

    public async getConnectionsForRoom(roomId: string): Promise<MigratedConnections> {
        const feeds: FeedConnectionState[] = [];

        for (const id of this.serviceIds) {
            const endpoint = this.apiUrl + (this.apiUrl.endsWith('/') ? '' : '/') + 'admin/getService';
            const res = await axios.post(endpoint, { 'Id': id });
            const obj = res.data;
            switch (obj.Type) {
                case 'rssbot': {
                    const roomFeeds = GoNebMigrator.convertFeeds(obj.Config.feeds).get(roomId) ?? [];
                    feeds.push(...roomFeeds);
                    break;
                }
                default: {
                    log.warn(`Unrecognized go-neb service type (${obj.Type}), skipping`);
                }
            }
        }

        return {
            feeds,
        };
    }
}
