import { Logger } from "matrix-appservice-bridge";
import axios from "axios";

import { FeedConnection, FeedConnectionState, GitHubRepoConnection, GitHubRepoConnectionState } from "../Connections";
import { AllowedEvents as GitHubAllowedEvents, AllowedEventsNames as GitHubAllowedEventsNames } from "../Connections/GithubRepo";

const log = new Logger("GoNebMigrator");

interface MigratedConnections {
    [FeedConnection.ServiceCategory]: FeedConnectionState[]|undefined,
    [GitHubRepoConnection.ServiceCategory]: GitHubRepoConnectionState[]|undefined;
}

interface GoNebFeedsConfig {
    [url: string]: {
        rooms: string[],
    }
}

interface GoNebGithubRepos {
    [githubPath: string]: {
        Events: string[], // push, issues, pull_request, more?
    }
}

interface GoNebService {
    Type: string;
    Config: any;
}

interface GoNebGithubWebhookService extends GoNebService {
    Type: 'github-webhook';
    Config: {
        ClientUserID: string;
        Rooms: {
            [roomId: string]: { Repos: GoNebGithubRepos; }
        }
    };
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

    static convertGithub(roomRepos: GoNebGithubRepos): GitHubRepoConnectionState[] {
        const eventMapping: { [goNebEvent: string]: GitHubAllowedEventsNames } = {
            'pull_request': 'pull_request',
            'issues': 'issue',
            // 'push': ???
        };
        return Object.entries(roomRepos).map(([githubPath, { Events }]) => {
            const [org, repo] = githubPath.split('/');
            const enableHooks = Events.map(goNebEvent => eventMapping[goNebEvent]).filter(e => !!e);

            return {
                org,
                repo,
                enableHooks,
            };
        });
    }

    public async getConnectionsForRoom(roomId: string, userId: string): Promise<MigratedConnections> {
        const feeds: FeedConnectionState[] = [];
        const github: GitHubRepoConnectionState[] = [];

        for (const id of this.serviceIds) {
            const endpoint = this.apiUrl + (this.apiUrl.endsWith('/') ? '' : '/') + 'admin/getService';
            const res = await axios.post(endpoint, { 'Id': id });
            const obj = res.data as GoNebService;
            switch (obj.Type) {
                case 'rssbot': {
                    const roomFeeds = GoNebMigrator.convertFeeds(obj.Config.feeds).get(roomId) ?? [];
                    feeds.push(...roomFeeds);
                    break;
                };
                case 'github-webhook': {
                    const service = obj as GoNebGithubWebhookService;
                    if (service.Config.ClientUserID === userId) {
                        const roomRepos = service.Config.Rooms[roomId]?.Repos;
                        if (roomRepos) {
                            const githubConnections = GoNebMigrator.convertGithub(roomRepos);
                            github.push(...githubConnections);
                        }
                    }
                    break;
                };
                default: {
                    log.warn(`Unrecognized go-neb service type (${obj.Type}), skipping`);
                };
            }
        }

        return {
            feeds,
            github,
        };
    }
}
