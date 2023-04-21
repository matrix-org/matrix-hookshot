import { Logger } from "matrix-appservice-bridge";
import axios from "axios";

import { FeedConnection, FeedConnectionState, GitHubRepoConnection, GitHubRepoConnectionState } from "../Connections";
import { AllowedEventsNames as GitHubAllowedEventsNames } from "../Connections/GithubRepo";

const log = new Logger("GoNebMigrator");

interface MigratedGoNebConnection {
    goNebId: string;
}

type MigratedFeed = FeedConnectionState & MigratedGoNebConnection;
type MigratedGithub = GitHubRepoConnectionState & MigratedGoNebConnection;

interface MigratedConnections {
    [FeedConnection.ServiceCategory]: MigratedFeed[]|undefined,
    [GitHubRepoConnection.ServiceCategory]: MigratedGithub[]|undefined;
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
    private goNebBotPrefix: string;
    constructor(
        private apiUrl: string,
        private serviceIds?: string[],
        goNebBotPrefix?: string,
    ) {
        this.goNebBotPrefix = goNebBotPrefix ?? '@_neb_';
    }

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

    public async getConnectionsForRoom(roomId: string, userIds: Set<string>): Promise<MigratedConnections> {
        const feeds: MigratedFeed[] = [];
        const github: MigratedGithub[] = [];

        const serviceIds = new Set([
            ...(this.serviceIds ?? []),
            ...['rssbot', 'github'].flatMap(type => Array.from(userIds).map(userId => `${type}/${strictEncodeURIComponent(userId)}/${strictEncodeURIComponent(roomId)}`)),
        ]);

        for (const id of serviceIds) {
            const endpoint = this.apiUrl + (this.apiUrl.endsWith('/') ? '' : '/') + 'admin/getService';
            let obj: GoNebService;
            try {
                const res = await axios.post(endpoint, { 'Id': id });
                obj = res.data as GoNebService;
            } catch (err: unknown) {
                if (axios.isAxiosError(err)) {
                    if (err.response?.status === 404) {
                        continue;
                    }
                }

                throw err;
            }
            switch (obj.Type) {
                case 'rssbot': {
                    const roomFeeds = GoNebMigrator.convertFeeds(obj.Config.feeds).get(roomId) ?? [];
                    const migratedFeeds = roomFeeds.map(f => ({ ...f, goNebId: id }));
                    feeds.push(...migratedFeeds);
                    break;
                }
                case 'github-webhook': {
                    const service = obj as GoNebGithubWebhookService;
                    if (userIds.has(service.Config.ClientUserID)) {
                        const roomRepos = service.Config.Rooms[roomId]?.Repos;
                        if (roomRepos) {
                            const githubConnections = GoNebMigrator.convertGithub(roomRepos);
                            const migratedGithubs = githubConnections.map(f => ({ ...f, goNebId: id }));
                            github.push(...migratedGithubs);
                        }
                    }
                    break;
                }
                default: {
                    log.warn(`Unrecognized go-neb service type (${obj.Type}), skipping`);
                }
            }
        }

        return {
            feeds,
            github,
        };
    }

    public getGoNebUsersFromRoomMembers(members: string[]): string[] {
        const goNebUsers = [];

        for (const member of members) {
            if (member.startsWith(this.goNebBotPrefix)) {
                try {
                    const mxid = this.getUserMxid(member);
                    goNebUsers.push(mxid);
                } catch (err: unknown) {
                    log.error(`${member} looks like a go-neb mxid, but we failed to extract the owner mxid from it (${err})`);
                }
            }
        }

        return goNebUsers;
    }

    private getUserMxid(botMxid: string): string {
        let userPart = botMxid.substring(this.goNebBotPrefix.length);
        // strip the service type (before first '_') and server name (after ':')
        try {
            [, userPart] = userPart.match(/[^_]+_([^:]+):.*/)!;
        } catch (err: unknown) {
            throw new Error(`${botMxid} does not look like a Scalar-produced go-neb mxid`);
        }

        // decode according to https://spec.matrix.org/v1.2/appendices/#mapping-from-other-character-sets,
        return userPart.replace(/=\w\w/g, (match) => {
            // first the lowercased string...
            const code = parseInt(match.substring(1), 16);
            return String.fromCharCode(code);
        }).replace(/_\w/g, (match) => {
            // and then reapply the uppercase where applicable
            return match.substring(1).toUpperCase();
        });
    }
}

// from https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/encodeURIComponent#encoding_for_rfc3986
function strictEncodeURIComponent(str: string) {
  return encodeURIComponent(str)
    .replace(
      /[!'()*]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
    );
}
