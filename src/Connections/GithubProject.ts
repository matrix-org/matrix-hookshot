import { Connection, IConnection, InstantiateConnectionOpts } from "./IConnection";
import { Appservice, Intent, StateEvent } from "matrix-bot-sdk";
import { Logger } from "matrix-appservice-bridge";
import { ProjectsGetResponseData } from "../github/Types";
import { BaseConnection } from "./BaseConnection";
import { ConfigGrantChecker, GrantChecker } from "../grants/GrantCheck";
import { BridgeConfig } from "../config/Config";

export interface GitHubProjectConnectionState {
    project_id: number;
    state: "open"|"closed";
}
const log = new Logger("GitHubProjectConnection");

/**
 * Handles rooms connected to a GitHub project.
 */
@Connection
export class GitHubProjectConnection extends BaseConnection implements IConnection {
    static readonly CanonicalEventType = "uk.half-shot.matrix-hookshot.github.project";
    static readonly LegacyCanonicalEventType = "uk.half-shot.matrix-github.project";
    static readonly ServiceCategory = "github";
    static readonly EventTypes = [
        GitHubProjectConnection.CanonicalEventType,
        GitHubProjectConnection.LegacyCanonicalEventType,
    ];

    public static createConnectionForState(roomId: string, event: StateEvent<any>, {config, as, intent}: InstantiateConnectionOpts) {
        if (!config.github) {
            throw Error('GitHub is not configured');
        }
        return new GitHubProjectConnection(roomId, as, intent, config, event.content, event.stateKey);
    }

    public static getGrantKey(projectId: number) {
        return `${this.CanonicalEventType}/${projectId}`;
    }

    static async onOpenProject(project: ProjectsGetResponseData, as: Appservice, intent: Intent, config: BridgeConfig, inviteUser: string): Promise<GitHubProjectConnection> {
        log.info(`Fetching ${project.name} ${project.id}`);

        // URL hack so we don't need to fetch the repo itself.

        const state: GitHubProjectConnectionState = {
            project_id: project.id,
            state: project.state as "open"|"closed",
        };

        const roomId = await intent.underlyingClient.createRoom({
            visibility: "private",
            name: `${project.name}`,
            topic: project.body || undefined,
            preset: "private_chat",
            invite: [inviteUser],
            initial_state: [
                {
                    type: this.CanonicalEventType,
                    content: state,
                    state_key: project.url,
                },
            ],
        });
        await new GrantChecker(as.botIntent, 'github').grantConnection(roomId, this.getGrantKey(project.id));

        return new GitHubProjectConnection(roomId, as, intent, config, state, project.url)
    }

    get projectId() {
        return this.state.project_id;
    }

    private readonly grantChecker: GrantChecker;

    constructor(
        public readonly roomId: string,
        as: Appservice,
        intent: Intent,
        config: BridgeConfig,
        private state: GitHubProjectConnectionState,
        stateKey: string,
    ) {
        super(roomId, stateKey, GitHubProjectConnection.CanonicalEventType);
        this.grantChecker = new ConfigGrantChecker("github", as, config);
    }

    public ensureGrant(sender?: string) {
        return this.grantChecker.assertConnectionGranted(this.roomId, GitHubProjectConnection.getGrantKey(this.state.project_id), sender);
    }

    public isInterestedInStateEvent(eventType: string, stateKey: string) {
        return GitHubProjectConnection.EventTypes.includes(eventType) && this.stateKey === stateKey;
    }

    public toString() {
        return `GitHubProjectConnection ${this.state.project_id}}`;
    }
}
