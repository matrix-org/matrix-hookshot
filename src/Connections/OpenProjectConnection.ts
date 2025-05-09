import { Connection, IConnection, IConnectionState, InstantiateConnectionOpts, ProvisionConnectionOpts } from "./IConnection";
import { Appservice, Intent, StateEvent } from "matrix-bot-sdk";
import { Logger } from "matrix-appservice-bridge";
import markdownit from "markdown-it";
import { BotCommands, compileBotCommands } from "../BotCommands";
import { MatrixMessageContent } from "../MatrixEvent";
import { CommandConnection } from "./CommandConnection";
import { UserTokenStore } from "../tokens/UserTokenStore";
import { ApiError, ErrCode } from "../api";
import { GetConnectionsResponseItem } from "../provisioning/api";
import { OpenProjectWebhookPayloadWorkPackage } from "../openproject/types";
import { BridgeOpenProjectConfig } from "../config/sections/openproject";
import { formatWorkPackageDiff, formatWorkPackageForMatrix } from "../openproject/format";
import { IBridgeStorageProvider } from "../Stores/StorageProvider";
import { workPackageToCacheState } from "../openproject/state";

export type OpenProjectEventsNames =
    "work_package:created" |
    "work_package:updated" |
    "work_package:assignee_changed" |
    "work_package:description_changed" | 
    "work_package:duedate_changed" |
    "work_package:workpercent_changed" |
    "work_package:priority_changed" |
    "work_package:responsible_changed" |
    "work_package:subject_changed";

const JiraAllowedEvents: OpenProjectEventsNames[] = [
    "work_package:created",
    "work_package:updated",
    "work_package:assignee_changed",
    "work_package:description_changed", 
    "work_package:duedate_changed",
    "work_package:workpercent_changed",
    "work_package:priority_changed",
    "work_package:responsible_changed",
    "work_package:subject_changed",
];

export interface OpenProjectConnectionState extends IConnectionState {
    url: string;
    events: OpenProjectEventsNames[],
}


export type OpenProjectResponseItem = GetConnectionsResponseItem<OpenProjectConnectionState>;


function validateOpenProjectConnectionState(state: unknown): OpenProjectConnectionState {
    const {url, commandPrefix, priority} = state as Partial<OpenProjectConnectionState>;
    if (url === undefined || typeof url !== "string") {
        throw new ApiError("Expected 'url' to be a string", ErrCode.BadValue);
    }
    if (!URL.canParse(url)) {
        throw new ApiError("Expected 'url' to be a URL", ErrCode.BadValue);
    }
    if (commandPrefix) {
        if (typeof commandPrefix !== "string") {
            throw new ApiError("Expected 'commandPrefix' to be a string", ErrCode.BadValue);
        }
        if (commandPrefix.length < 2 || commandPrefix.length > 24) {
            throw new ApiError("Expected 'commandPrefix' to be between 2-24 characters", ErrCode.BadValue);
        }
    }
    let {events} = state as Partial<OpenProjectConnectionState>;
    events = events ?? ["work_package:created", "work_package:updated"];
    if (events.find((ev) => !JiraAllowedEvents.includes(ev))?.length) {
        throw new ApiError(`'events' can only contain ${JiraAllowedEvents.join(", ")}`, ErrCode.BadValue);
    }
    return {url, commandPrefix, events, priority};
}

const log = new Logger("OpenProjectConnection");
const md = new markdownit();

/**
 * Handles rooms connected to a Jira project.
 */
@Connection
export class OpenProjectConnection extends CommandConnection<OpenProjectConnectionState> implements IConnection {
    static readonly CanonicalEventType = "org.matrix.matrix-hookshot.openproject.project";

    static readonly EventTypes = [
        OpenProjectConnection.CanonicalEventType,
    ];
    static readonly ServiceCategory = "openproject";
    static botCommands: BotCommands;
    static helpMessage: (cmdPrefix?: string) => MatrixMessageContent;

    static async assertUserHasAccessToProject(tokenStore: UserTokenStore, userId: string, url: string) {
        // TODO.
    }

    static async provisionConnection(roomId: string, userId: string, data: Record<string, unknown>, {as, intent, tokenStore, config, storage}: ProvisionConnectionOpts) {
        if (!config.openProject) {
            throw new ApiError('OpenProject integration is not configured', ErrCode.DisabledFeature);
        }
        const validData = validateOpenProjectConnectionState(data);
        log.info(`Attempting to provisionConnection for ${roomId} ${validData.url} on behalf of ${userId}`);
        const project = await this.assertUserHasAccessToProject(tokenStore,  userId, validData.url);
        const connection = new OpenProjectConnection(roomId, as, intent, config.openProject, validData, validData.url, tokenStore, storage);
        await intent.underlyingClient.sendStateEvent(roomId, OpenProjectConnection.CanonicalEventType, connection.stateKey, validData);
        log.info(`Created connection via provisionConnection ${connection.toString()}`);
        return {connection};
    }

    static createConnectionForState(roomId: string, state: StateEvent<Record<string, unknown>>, {config, as, intent, tokenStore, storage}: InstantiateConnectionOpts) {
        if (!config.openProject) {
            throw Error('OpenProject is not configured');
        }
        const connectionConfig = validateOpenProjectConnectionState(state.content);
        return new OpenProjectConnection(roomId, as, intent, config.openProject, connectionConfig, state.stateKey, tokenStore, storage);
    }

    public get priority(): number {
        return this.state.priority || super.priority;
    }

    public toString() {
        return `OpenProjectConnection ${this.projectId}`;
    }

    public isInterestedInHookEvent(eventName: OpenProjectEventsNames, interestedByDefault = false) {
        return !this.state.events ? interestedByDefault : this.state.events.includes(eventName);
    }

    public interestedInProject(project: number) {
        if (this.projectId === project) {
            return true;
        }
        return false;
    }

    public readonly url: URL;
    public readonly projectId: number;

    constructor(
        roomId: string,
        private readonly as: Appservice,
        private readonly intent: Intent,
        private readonly config: BridgeOpenProjectConfig,
        state: OpenProjectConnectionState,
        stateKey: string,
        private readonly tokenStore: UserTokenStore,
        private readonly storage: IBridgeStorageProvider,
    ) {
        super(
            roomId,
            stateKey,
            OpenProjectConnection.CanonicalEventType,
            state,
            intent.underlyingClient,
            OpenProjectConnection.botCommands,
            OpenProjectConnection.helpMessage,
            ["openproject"],
            "!openproject",
            "openproject"
        );
        this.url = new URL(state.url);
        this.projectId = parseInt(/\/projects\/(\d+)\/?/.exec(this.url.pathname)?.[1] ?? "");
        if (isNaN(this.projectId)) {
            throw Error('URL for project doesnt contain a project ID');
        }
    }

    public isInterestedInStateEvent(eventType: string, stateKey: string) {
        return OpenProjectConnection.EventTypes.includes(eventType) && this.stateKey === stateKey;
    }

    protected validateConnectionState(content: unknown) {
        return validateOpenProjectConnectionState(content);
    }

    public ensureGrant(sender?: string) {
        // TODO
        // return this.grantChecker.assertConnectionGranted(this.roomId, {
        //     url: this.state.url,
        // }, sender);
    }

    public async onWorkPackageCreated(data: OpenProjectWebhookPayloadWorkPackage) {
        if (!this.isInterestedInHookEvent('work_package:created')) {
            return;
        }
        log.info(`onWorkPackageCreated ${this.roomId} ${this.projectId} ${data.work_package.id}`);

        const creator = data.work_package._embedded.author;
        if (!creator) {
            throw Error('No creator field');
        }
        const extraData = formatWorkPackageForMatrix(data.work_package, this.config.baseURL);
        const content = `${creator.name} created a new work package [${data.work_package.id}](${extraData["org.matrix.matrix-hookshot.openproject.work_package"].url}): "${data.work_package.subject}"`;
        await this.intent.sendEvent(this.roomId, {
            msgtype: "m.notice",
            body: content,
            formatted_body: md.renderInline(content),
            format: "org.matrix.custom.html",
            ...formatWorkPackageForMatrix(data.work_package, this.config.baseURL),
        });
        await this.storage.setOpenProjectWorkPackageState(workPackageToCacheState(data.work_package), data.work_package.id);
    }

    public async onWorkPackageUpdated(data: OpenProjectWebhookPayloadWorkPackage) {
        log.info(`onWorkPackageUpdated ${this.roomId} ${this.projectId} ${data.work_package.id}`);

        const creator = data.work_package._embedded.author;
        if (!creator) {
            throw Error('No creator field');
        }
        const extraData = formatWorkPackageForMatrix(data.work_package, this.config.baseURL);
        const oldChanges = await this.storage.getOpenProjectWorkPackageState(data.work_package._embedded.project.id, data.work_package.id);

        // Detect what changed.
        let changeStatement = "updated work package";
        let postfix;
        let hookEvent: OpenProjectEventsNames = "work_package:updated";
        if (oldChanges) {
            const diffSet = formatWorkPackageDiff(oldChanges, data.work_package);
            if (diffSet) {
                hookEvent = diffSet.eventKind;
                postfix = diffSet.postfix;
                if (diffSet.changes.length === 1) {
                    changeStatement = diffSet.changes[0];
                } else {
                    postfix = `  - ${diffSet.changes.join('\n  - ')}`;
                }
            } else {
                // Changes were not understood, skip.
                return;
            }
        }
        if (!this.isInterestedInHookEvent(hookEvent ?? "work_package:updated")) {
            return;
        }
        const content = `**${creator.name}** ${changeStatement} for [${data.work_package.id}](${extraData["org.matrix.matrix-hookshot.openproject.work_package"].url}): "${data.work_package.subject}"`;

        await this.intent.sendEvent(this.roomId, {
            msgtype: "m.notice",
            body: content + (postfix ? postfix : ""),
            formatted_body: md.renderInline(content) + (postfix ? md.render(postfix) : ""),
            format: "org.matrix.custom.html",
            ...formatWorkPackageForMatrix(data.work_package, this.config.baseURL),
        });
        await this.storage.setOpenProjectWorkPackageState(workPackageToCacheState(data.work_package), data.work_package.id);
    }

    public static getProvisionerDetails(botUserId: string) {
        return {
            service: "openproject",
            eventType: OpenProjectConnection.CanonicalEventType,
            type: "OpenProject",
            botUserId: botUserId,
        }
    }

    public getProvisionerDetails(): OpenProjectResponseItem {
        return {
            ...OpenProjectConnection.getProvisionerDetails(this.intent.userId),
            id: this.connectionId,
            config: {
                ...this.state,
            },
        }
    }

    public async onRemove() {
        log.info(`Removing ${this.toString()} for ${this.roomId}`);
        // await this.grantChecker.ungrantConnection(this.roomId, {
        //     url: this.state.url,
        // });
        // Do a sanity check that the event exists.
        await this.intent.underlyingClient.getRoomStateEvent(this.roomId, OpenProjectConnection.CanonicalEventType, this.stateKey);
        await this.intent.underlyingClient.sendStateEvent(this.roomId, OpenProjectConnection.CanonicalEventType, this.stateKey, { disabled: true });
    }

    public async provisionerUpdateConfig(userId: string, config: Record<string, unknown>) {
        // Apply previous state to the current config, as provisioners might not return "unknown" keys.
        config = { ...this.state, ...config };
        const validatedConfig = validateOpenProjectConnectionState(config);
        await this.intent.underlyingClient.sendStateEvent(this.roomId, OpenProjectConnection.CanonicalEventType, this.stateKey, validatedConfig);
        this.state = validatedConfig;
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const res = compileBotCommands(OpenProjectConnection.prototype as any, CommandConnection.prototype as any);
OpenProjectConnection.helpMessage = res.helpMessage;
OpenProjectConnection.botCommands = res.botCommands;
