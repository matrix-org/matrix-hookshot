import { Intent, StateEvent } from "matrix-bot-sdk";
import markdownit from "markdown-it";
import { BaseConnection } from "./BaseConnection";
import { IConnection, IConnectionState } from ".";
import { Connection, InstantiateConnectionOpts, ProvisionConnectionOpts } from "./IConnection";

export interface HoundConnectionState extends IConnectionState {
    challengeId: string;
}

export interface HoundPayload {
    activity: HoundActivity,
    challengeId: string,
}

export interface HoundActivity {
    id: string;
    distance: number; // in meters
    duration: number;
    elevation: number;
    createdAt: string;
    activityType: string;
    activityName: string;
    user: {
        id: string;
        fullname: string;
        fname: string;
        lname: string;
    }
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
        default:
            return "🕴️";
    }
}

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


    public static validateState(data: Record<string, unknown>): HoundConnectionState {
        // Previously URL was supported.
        if (!data.challengeId && data.url && data.url === "string") {
            const parts = new URL(data.url).pathname.split('/');
            data.challengeId = parts[parts.length-1];
        }

        // Test for v1 uuid.
        if (!data.challengeId || typeof data.challengeId !== "string" || /^\w{8}(?:\-\w{4}){3}-\w{12}$/.test(data.challengeId)) {
            throw Error('Missing or invalid id');
        }

        return {
            challengeId: data.challengeId
        }
    }

    public static createConnectionForState(roomId: string, event: StateEvent<any>, {config, intent}: InstantiateConnectionOpts) {
        if (!config.challengeHound) {
            throw Error('Challenge hound is not configured');
        }
        return new HoundConnection(roomId, event.stateKey, event.content, intent);
    }

    static async provisionConnection(roomId: string, _userId: string, data: Record<string, unknown> = {}, {intent, config}: ProvisionConnectionOpts) {
        if (!config.challengeHound) {
            throw Error('Challenge hound is not configured');
        }
        const validState = this.validateState(data);
        const connection = new HoundConnection(roomId, validState.challengeId, validState, intent);
        await intent.underlyingClient.sendStateEvent(roomId, HoundConnection.CanonicalEventType, validState.challengeId, validState);
        return {
            connection,
            stateEventContent: validState,
        }
    }

    constructor(
        roomId: string,
        stateKey: string,
        private state: HoundConnectionState,
        private readonly intent: Intent) {
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

    public async handleNewActivity(payload: HoundActivity) {
        const distance = `${(payload.distance / 1000).toFixed(2)}km`;
        const emoji = getEmojiForType(payload.activityType);
        const body = `🎉 **${payload.user.fullname}** completed a ${distance} ${emoji} ${payload.activityType} (${payload.activityName})`;
        const content: any = {
            body,
            format: "org.matrix.custom.html",
            formatted_body: md.renderInline(body),
        };
        content["msgtype"] = "m.notice";
        content["uk.half-shot.matrix-challenger.activity.id"] = payload.id;
        content["uk.half-shot.matrix-challenger.activity.distance"] = Math.round(payload.distance);
        content["uk.half-shot.matrix-challenger.activity.elevation"] = Math.round(payload.elevation);
        content["uk.half-shot.matrix-challenger.activity.duration"] = Math.round(payload.duration);
        content["uk.half-shot.matrix-challenger.activity.user"] = {
            "name": payload.user.fullname,
            id: payload.user.id,
        };
        await this.intent.underlyingClient.sendMessage(this.roomId, content);
    }

    public toString() {
        return `HoundConnection ${this.challengeId}`;
    }
}
