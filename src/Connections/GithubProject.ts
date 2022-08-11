import { Connection, IConnection, InstantiateConnectionOpts } from "./IConnection";
import { Appservice, StateEvent } from "matrix-bot-sdk";
import LogWrapper from "../LogWrapper";
import { ProjectsGetResponseData } from "../Github/Types";
import { BaseConnection } from "./BaseConnection";

export interface GitHubProjectConnectionState {
    // eslint-disable-next-line camelcase
    project_id: number;
    state: "open"|"closed";
}
const log = new LogWrapper("GitHubProjectConnection");

/**
 * Handles rooms connected to a github repo.
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

    public static createConnectionForState(roomId: string, event: StateEvent<any>, {config, as}: InstantiateConnectionOpts) {
        if (!config.github) {
            throw Error('GitHub is not configured');
        }
        return new GitHubProjectConnection(roomId, as, event.content, event.stateKey);
    }

    static async onOpenProject(project: ProjectsGetResponseData, as: Appservice, inviteUser: string): Promise<GitHubProjectConnection> {
        log.info(`Fetching ${project.name} ${project.id}`);

        // URL hack so we don't need to fetch the repo itself.

        const state: GitHubProjectConnectionState = {
            project_id: project.id,
            state: project.state as "open"|"closed",
        };

        const roomId = await as.botClient.createRoom({
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
        
        return new GitHubProjectConnection(roomId, as, state, project.url)
    }

    get projectId() {
        return this.state.project_id;
    }

    constructor(public readonly roomId: string,
        as: Appservice,
        private state: GitHubProjectConnectionState,
        stateKey: string) {
            super(roomId, stateKey, GitHubProjectConnection.CanonicalEventType);
        }

    public isInterestedInStateEvent(eventType: string, stateKey: string) {
        return GitHubProjectConnection.EventTypes.includes(eventType) && this.stateKey === stateKey;
    }

    public toString() {
        return `GitHubProjectConnection ${this.state.project_id}}`;
    }
}