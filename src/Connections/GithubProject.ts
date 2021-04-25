import { IConnection } from "./IConnection";
import { Appservice } from "matrix-bot-sdk";
import LogWrapper from "../LogWrapper";
import { ProjectsGetResponseData } from "../Github/Types";

export interface GitHubProjectConnectionState {
    // eslint-disable-next-line camelcase
    project_id: number;
    state: "open"|"closed";
}
const log = new LogWrapper("GitHubProjectConnection");

/**
 * Handles rooms connected to a github repo.
 */
export class GitHubProjectConnection implements IConnection {
    static readonly CanonicalEventType = "uk.half-shot.matrix-github.project";

    static readonly EventTypes = [
        GitHubProjectConnection.CanonicalEventType, // Legacy event, with an awful name.
    ];

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
            topic: project.body,
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

    constructor(public readonly roomId: string,
        as: Appservice,
        private state: GitHubProjectConnectionState,
        private stateKey: string) { }

    public isInterestedInStateEvent(eventType: string, stateKey: string) {
        return GitHubProjectConnection.EventTypes.includes(eventType) && this.stateKey === stateKey;
    }

    public toString() {
        return `GitHubProjectConnection ${this.state.project_id}}`;
    }
}