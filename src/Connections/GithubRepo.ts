import { IConnection } from "./IConnection";
import { Appservice } from "matrix-bot-sdk";

export interface GitHubRepoConnectionState {}

/**
 * Handles rooms connected to a github repo.
 */
export class GitHubRepoConnection implements IConnection {
    static readonly EventTypes = ["uk.half-shot.matrix-github.github.repo"];

    constructor(public readonly roomId: string, as: Appservice, state: GitHubRepoConnectionState) {

    }
    public isInterestedInStateEvent(eventType: string) {
        return false;
    }

    public async onEvent() {

    }

    public async onStateUpdate() {

    }

    public toString() {
        return `GitHubRepo`;
    }
}