import { Connection, IConnection, InstantiateConnectionOpts } from "./IConnection";
import { Appservice, Space, StateEvent } from "matrix-bot-sdk";
import { Logger } from "matrix-appservice-bridge";
import { ReposGetResponseData } from "../github/Types";
import axios from "axios";
import { GitHubDiscussionConnection } from "./GithubDiscussion";
import { GithubInstance } from "../github/GithubInstance";
import { BaseConnection } from "./BaseConnection";
import { ConfigGrantChecker, GrantChecker } from "../grants/GrantCheck";
import { BridgeConfig } from "../config/Config";

const log = new Logger("GitHubDiscussionSpace");

export interface GitHubDiscussionSpaceConnectionState {
    owner: string;
    repo: string;
}

/**
 * Handles spaces connected to a GitHub discussion.
 */
@Connection
export class GitHubDiscussionSpace extends BaseConnection implements IConnection {
    static readonly CanonicalEventType = "uk.half-shot.matrix-hookshot.github.discussion.space";
    static readonly LegacyCanonicalEventType = "uk.half-shot.matrix-github.discussion.space";

    static readonly EventTypes = [
        GitHubDiscussionSpace.CanonicalEventType,
        GitHubDiscussionSpace.LegacyCanonicalEventType,
    ];

    static readonly QueryRoomRegex = /#github_disc_(.+)_(.+):.*/;
    static readonly ServiceCategory = "github";

    public static async createConnectionForState(roomId: string, event: StateEvent<any>, {
        github, config, as, intent}: InstantiateConnectionOpts) {
        if (!github || !config.github) {
            throw Error('GitHub is not configured');
        }
        await new GrantChecker(as.botIntent, 'github').grantConnection(roomId, this.grantKey(event.content));
        return new GitHubDiscussionSpace(
            as, config, await intent.underlyingClient.getSpace(roomId), event.content, event.stateKey
        );
    }

    public static async onQueryRoom(result: RegExpExecArray, opts: {githubInstance: GithubInstance, as: Appservice}): Promise<Record<string, unknown>> {
        if (!result || result.length < 2) {
            log.error(`Invalid alias pattern '${result}'`);
            throw Error("Could not find issue");
        }

        const [ owner, repo ] = result.slice(1);

        log.info(`Fetching ${owner}/${repo}`);
        let repoRes: ReposGetResponseData;
        const octokit = opts.githubInstance.getOctokitForRepo(owner, repo);
        try {
            // TODO: Determine if the repo has discussions?
            repoRes = (await octokit.repos.get({
                owner,
                repo,
            })).data;
            if (!repoRes.owner) {
                throw Error('Repo has no owner!');
            }
            if (repoRes.private) {
                throw Error('Refusing to bridge private repo');
            }
        } catch (ex) {
            log.error("Failed to get repo:", ex);
            throw Error("Could not find repo");
        }
        const state: GitHubDiscussionSpaceConnectionState = {
            owner: repoRes.owner.login.toLowerCase(),
            repo: repoRes.name.toLowerCase(),
        };

        // URL hack so we don't need to fetch the repo itself.
        let avatarUrl = undefined;
        try {
            const profile = await octokit.users.getByUsername({
                username: owner,
            });
            if (profile.data.avatar_url) {
                const res = await axios.get(profile.data.avatar_url as string, {
                    responseType: 'arraybuffer',
                });
                log.info(`uploading ${profile.data.avatar_url}`);
                const contentType: string = res.headers["content-type"];
                const mxcUrl = await opts.as.botClient.uploadContent(
                    Buffer.from(res.data as ArrayBuffer),
                    contentType,
                    `avatar_${profile.data.id}.png`,
                );
                avatarUrl = {
                    type: "m.room.avatar",
                    state_key: "",
                    content: {
                        url: mxcUrl,
                    },
                };
            }
        } catch (ex) {
            log.warn("Failed to get avatar for org:", ex);
        }

        return {
            visibility: "public",
            name: `${state.owner}/${state.repo} Discussions`,
            topic: `GitHub discussion index for ${state.owner}/${state.repo}`,
            preset: 'public_chat',
            room_alias_name: `github_disc_${owner.toLowerCase()}_${repo.toLowerCase()}`,
            initial_state: [

                {
                    type: this.CanonicalEventType,
                    content: state,
                    state_key: `${state.owner}/${state.repo}`,
                },
                avatarUrl,
                {
                    type: "m.room.history_visibility",
                    state_key: "",
                    content: {
                        history_visibility: 'world_readable',
                    },
                },
            ],
            creation_content: {
                type: "m.space",
            },
            power_level_content_override: {
                ban: 100,
                events_default: 50,
                invite: 50,
                kick: 100,
                notifications: {
                    room: 100,
                },
                redact: 100,
                state_default: 100,
                users_default: 0,
            },
        };
    }

    private static grantKey(state: GitHubDiscussionSpaceConnectionState) {
        return `${this.CanonicalEventType}/${state.owner}/${state.repo}`;
    }

    private readonly grantChecker: GrantChecker;

    constructor(as: Appservice,
        config: BridgeConfig,
        public readonly space: Space,
        private state: GitHubDiscussionSpaceConnectionState,
        stateKey: string) {
            super(space.roomId, stateKey, GitHubDiscussionSpace.CanonicalEventType)
            this.grantChecker = new ConfigGrantChecker("github", as, config);
        }

    public isInterestedInStateEvent(eventType: string, stateKey: string) {
        return GitHubDiscussionSpace.EventTypes.includes(eventType) && this.stateKey === stateKey;
    }

    public get repo() {
        return this.state.repo.toLowerCase();
    }

    public get owner() {
        return this.state.owner.toLowerCase();
    }

    public toString() {
        return `GitHubDiscussionSpace ${this.owner}/${this.repo}`;
    }

    public async onDiscussionCreated(discussion: GitHubDiscussionConnection) {
        log.info(`Adding connection to ${this.toString()}`);
        await this.space.addChildRoom(discussion.roomId);
    }
    

    public async ensureGrant(sender?: string) {
        await this.grantChecker.assertConnectionGranted(this.roomId, GitHubDiscussionSpace.grantKey(this.state), sender);
    }

    public async onRemove() {
        log.info(`Removing ${this.toString()} for ${this.roomId}`);
        this.grantChecker.ungrantConnection(this.roomId, GitHubDiscussionSpace.grantKey(this.state));
        // Do a sanity check that the event exists.
        try {

            await this.space.client.getRoomStateEvent(this.roomId, GitHubDiscussionSpace.CanonicalEventType, this.stateKey);
            await this.space.client.sendStateEvent(this.roomId, GitHubDiscussionSpace.CanonicalEventType, this.stateKey, { disabled: true });
        } catch (ex) {
            await this.space.client.getRoomStateEvent(this.roomId, GitHubDiscussionSpace.LegacyCanonicalEventType, this.stateKey);
            await this.space.client.sendStateEvent(this.roomId, GitHubDiscussionSpace.LegacyCanonicalEventType, this.stateKey, { disabled: true });
        }
    }
}
