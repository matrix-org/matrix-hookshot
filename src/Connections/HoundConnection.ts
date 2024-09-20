import { Intent, StateEvent } from "matrix-bot-sdk";
import markdownit from "markdown-it";
import { BaseConnection } from "./BaseConnection";
import { IConnection, IConnectionState } from ".";
import { Connection, InstantiateConnectionOpts, ProvisionConnectionOpts } from "./IConnection";
import { CommandError } from "../errors";
import { IBridgeStorageProvider } from "../Stores/StorageProvider";
import { Logger } from "matrix-appservice-bridge";
export interface HoundConnectionState extends IConnectionState {
    challengeId: string;
}

export interface HoundPayload {
    activity: HoundActivity,
    challengeId: string,
}

/**
 * @url https://documenter.getpostman.com/view/22349866/UzXLzJUV#0913e0b9-9cb5-440e-9d8d-bf6430285ee9
 */
export interface HoundActivity {
    userId: string,
    activityId: string,
    participant: string,
    /**
     * @example "07/26/2022"
     */
    date: string,
    /**
     * @example "2022-07-26T13:49:22Z"
     */
    datetime: string,
    name: string,
    type: string,
    /**
     * @example strava
     */
    app: string,
    durationSeconds: number,
    /**
     * @example "1.39"
     */
    distanceKilometers: string,
    /**
     * @example "0.86"
     */
    distanceMiles: string,
    /**
     * @example "0.86"
     */
    elevationMeters: string,
    /**
     * @example "0.86"
     */
    elevationFeet: string,
}

export interface IChallenge {
    id: string;
    distance: number;
    duration: number;
    elevaion: number;
}

export interface ILeader {
    id: string;
    fullname: string;
    duration: number;
    distance: number;
    elevation: number;
}

function getEmojiForType(type: string) {
    switch (type) {
        case "run":
            return "🏃";
        case "virtualrun":
            return "👨‍💻🏃";
        case "ride":
        case "cycle":
        case "cycling":
            return "🚴";
        case "mountainbikeride":
            return "⛰️🚴";
        case "virtualride":
            return "👨‍💻🚴";
        case "walk":
        case "hike":
            return "🚶";
        case "skateboard":
            return "🛹";
        case "virtualwalk":
        case "virtualhike":
            return "👨‍💻🚶";
        case "alpineski":
            return "⛷️";
        case "swim":
            return "🏊";
        default:
            return "🕴️";
    }
}

const log = new Logger("HoundConnection");
const md = markdownit();
@Connection
export class HoundConnection extends BaseConnection implements IConnection {
    static readonly CanonicalEventType = "uk.half-shot.matrix-hookshot.challengehound.activity";
    static readonly LegacyEventType = "uk.half-shot.matrix-challenger.activity"; // Magically import from matrix-challenger

    static readonly EventTypes = [
        HoundConnection.CanonicalEventType,
        HoundConnection.LegacyEventType,
    ];
    static readonly ServiceCategory = "challengehound";

    public static getIdFromURL(url: string): string {
        const parts = new URL(url).pathname.split('/');
        return parts[parts.length-1];
    }

    public static validateState(data: Record<string, unknown>): HoundConnectionState {
        // Convert URL to ID.
        if (!data.challengeId && data.url && typeof data.url === "string") {
            data.challengeId = this.getIdFromURL(data.url);
        }

        // Test for v1 uuid.
        if (!data.challengeId || typeof data.challengeId !== "string" || !/^\w{8}(?:-\w{4}){3}-\w{12}$/.test(data.challengeId)) {
            throw Error('Missing or invalid id');
        }

        return {
            challengeId: data.challengeId
        }
    }

    public static createConnectionForState(roomId: string, event: StateEvent<Record<string, unknown>>, {config, intent, storage}: InstantiateConnectionOpts) {
        if (!config.challengeHound) {
            throw Error('Challenge hound is not configured');
        }
        return new HoundConnection(roomId, event.stateKey, this.validateState(event.content), intent, storage);
    }

    static async provisionConnection(roomId: string, _userId: string, data: Record<string, unknown> = {}, {intent, config, storage}: ProvisionConnectionOpts) {
        if (!config.challengeHound) {
            throw Error('Challenge hound is not configured');
        }
        const validState = this.validateState(data);
        // Check the event actually exists.
        const statusDataRequest = await fetch(`https://api.challengehound.com/challenges/${validState.challengeId}/status`);
        if (!statusDataRequest.ok) {
            throw new CommandError(`Fetch failed, status ${statusDataRequest.status}`, "Challenge could not be found. Is it active?");
        }
        const { challengeName } = await statusDataRequest.json() as {challengeName: string};
        const connection = new HoundConnection(roomId, validState.challengeId, validState, intent, storage);
        await intent.underlyingClient.sendStateEvent(roomId, HoundConnection.CanonicalEventType, validState.challengeId, validState);
        return {
            connection,
            stateEventContent: validState,
            challengeName,
        };
    }

    constructor(
        roomId: string,
        stateKey: string,
        private state: HoundConnectionState,
        private readonly intent: Intent,
        private readonly storage: IBridgeStorageProvider) {
        super(roomId, stateKey, HoundConnection.CanonicalEventType)
    }

    public isInterestedInStateEvent() {
        return false; // We don't support state-updates...yet.
    }

    public get challengeId() {
        return this.state.challengeId;
    }

    public get priority(): number {
        return this.state.priority || super.priority;
    }

    public async handleNewActivity(activity: HoundActivity) {
        log.info(`New activity recorded ${activity.activityId}`);
        const existingActivityEventId = await this.storage.getHoundActivity(this.challengeId, activity.activityId);
        const distance = parseFloat(activity.distanceKilometers);
        const distanceUnits = `${(distance).toFixed(2)}km`;
        const emoji = getEmojiForType(activity.type);
        const body = `🎉 **${activity.participant}** completed a ${distanceUnits} ${emoji} ${activity.type} (${activity.name})`;
        let content: any = {
            body,
            format: "org.matrix.custom.html",
            formatted_body: md.renderInline(body),
        };
        content["msgtype"] = "m.notice";
        content["uk.half-shot.matrix-challenger.activity.id"] = activity.activityId;
        content["uk.half-shot.matrix-challenger.activity.distance"] = Math.round(distance * 1000);
        content["uk.half-shot.matrix-challenger.activity.elevation"] = Math.round(parseFloat(activity.elevationMeters));
        content["uk.half-shot.matrix-challenger.activity.duration"] = Math.round(activity.durationSeconds);
        content["uk.half-shot.matrix-challenger.activity.user"] = {
            "name": activity.participant,
            id: activity.userId,
        };
        if (existingActivityEventId) {
            log.debug(`Updating existing activity ${activity.activityId} ${existingActivityEventId}`);
            content = {
                body: `* ${content.body}`,
                msgtype: "m.notice",
                "m.new_content": content,
                "m.relates_to": {
                    "event_id": existingActivityEventId,
                    "rel_type": "m.replace"
                },
            };
        }
        const eventId = await this.intent.underlyingClient.sendMessage(this.roomId, content);
        await this.storage.storeHoundActivityEvent(this.challengeId, activity.activityId, eventId);
    }

    public toString() {
        return `HoundConnection ${this.challengeId}`;
    }
}
