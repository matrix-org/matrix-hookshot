import { IConnection } from "./IConnection";
import LogWrapper from "../LogWrapper";
import { MessageSenderClient } from "../MatrixSender"
import markdownit from "markdown-it";
import { Script, createContext } from "vm";
import { MatrixEvent } from "../MatrixEvent";
import { Appservice } from "matrix-bot-sdk";
import { v4 as uuid} from "uuid";
import { BridgeGenericWebhooksConfig } from "../Config/Config";
import { ApiError, ErrCode } from "../provisioning/api";
import { BaseConnection } from "./BaseConnection";
export interface GenericHookConnectionState {
    /**
     * This is ONLY used for display purposes, but the account data value is used to prevent misuse.
     */
    hookId?: string;
    /**
     * The name given in the provisioning UI and displaynames.
     */
    name: string;
    transformationFunction?: string;
}

/** */
export interface GenericHookAccountData {
    /**
     * This is where the true hook ID is kept. Each hook ID maps to a state_key.
     */
    [hookId: string]: string;
}

const log = new LogWrapper("GenericHookConnection");
const md = new markdownit();

const TRANSFORMATION_TIMEOUT_MS = 2000;

/**
 * Handles rooms connected to a github repo.
 */
export class GenericHookConnection extends BaseConnection implements IConnection {

    static validateState(state: Record<string, unknown>, allowJsTransformationFunctions: boolean): GenericHookConnectionState {
        const {name, transformationFunction} = state;
        let transformationFunctionResult: string|undefined;
        if (transformationFunction) {
            if (!allowJsTransformationFunctions) {
                throw new ApiError('Transformation functions are not allowed', ErrCode.DisabledFeature);
            }
            if (typeof transformationFunction !== "string") {
                throw new ApiError('Transformation functions must be a string', ErrCode.BadValue);
            }
            transformationFunctionResult = transformationFunction;
        }
        if (!name) {
            throw new ApiError('Missing name', ErrCode.BadValue);
        }
        if (typeof name !== "string" || name.length < 3 || name.length > 64) {
            throw new ApiError("'name' must be a string between 3-64 characters long", ErrCode.BadValue);
        }
        return {
            name,
            ...(transformationFunctionResult && {transformationFunction: transformationFunctionResult}),
        };
    }

    static async provisionConnection(roomId: string, as: Appservice, data: Record<string, unknown> = {}, config: BridgeGenericWebhooksConfig, messageClient: MessageSenderClient) {
        const hookId = uuid();
        const validState: GenericHookConnectionState = {
            ...GenericHookConnection.validateState(data, config.allowJsTransformationFunctions || false),
            hookId,
        };
        const connection = new GenericHookConnection(roomId, validState, hookId, validState.name, messageClient, config, as);
        await GenericHookConnection.ensureRoomAccountData(roomId, as, hookId, validState.name);
        return {
            connection,
            stateEventContent: validState,
        }
    }

    /**
     * This function ensures the account data for a room contains all the hookIds for the various state events.
     * @param roomId 
     * @param as 
     * @param connection 
     */
    static async ensureRoomAccountData(roomId: string, as: Appservice, hookId: string, stateKey: string, remove = false) {
        const data = await as.botClient.getSafeRoomAccountData<GenericHookAccountData>(GenericHookConnection.CanonicalEventType, roomId, {});
        if (remove && data[hookId] === stateKey) {
            delete data[hookId];
            await as.botClient.setRoomAccountData(GenericHookConnection.CanonicalEventType, roomId, data);
        }
        if (!remove && data[hookId] !== stateKey) {
            data[hookId] = stateKey;
            await as.botClient.setRoomAccountData(GenericHookConnection.CanonicalEventType, roomId, data);
        }
    }

    static readonly CanonicalEventType = "uk.half-shot.matrix-hookshot.generic.hook";
    static readonly LegacyCanonicalEventType = "uk.half-shot.matrix-github.generic.hook";

    static readonly EventTypes = [
        GenericHookConnection.CanonicalEventType,
        GenericHookConnection.LegacyCanonicalEventType,
    ];

    private transformationFunction?: Script;
    private cachedDisplayname?: string;

    constructor(roomId: string,
        private state: GenericHookConnectionState,
        public readonly hookId: string,
        stateKey: string,
        private readonly messageClient: MessageSenderClient,
        private readonly config: BridgeGenericWebhooksConfig,
        private readonly as: Appservice) {
            super(roomId, stateKey, GenericHookConnection.CanonicalEventType);
            if (state.transformationFunction && config.allowJsTransformationFunctions) {
                this.transformationFunction = new Script(state.transformationFunction);
            }
        }


    public isInterestedInStateEvent(eventType: string, stateKey: string) {
        return GenericHookConnection.EventTypes.includes(eventType) && this.stateKey === stateKey;
    }

    public getUserId() {
        if (!this.config.userIdPrefix) {
            return this.as.botUserId;
        }
        const [, domain] = this.as.botUserId.split(':');
        const name = this.state.name &&
             this.state.name.replace(/[A-Z]/g, (s) => s.toLowerCase()).replace(/([^a-z0-9\-.=_]+)/g, '');
        return `@${this.config.userIdPrefix}${name || 'bot'}:${domain}`;
    }

    public async ensureDisplayname() {
        if (!this.state.name) {
            return;
        }
        const sender = this.getUserId();
        const intent = this.as.getIntentForUserId(sender);
        const expectedDisplayname = `${this.state.name} (Webhook)`;

        try {
            if (this.cachedDisplayname !== expectedDisplayname) {
                this.cachedDisplayname = (await intent.underlyingClient.getUserProfile(sender)).displayname;
            }
        } catch (ex) {
            // Couldn't fetch, probably not set.
            await intent.ensureRegistered();
            this.cachedDisplayname = undefined;
        }
        if (this.cachedDisplayname !== expectedDisplayname) {
            await intent.underlyingClient.setDisplayName(`${this.state.name} (Webhook)`);
            this.cachedDisplayname = expectedDisplayname;
        }
    }

    public async onStateUpdate(stateEv: MatrixEvent<unknown>) {
        const validatedConfig = GenericHookConnection.validateState(stateEv.content as Record<string, unknown>, this.config.allowJsTransformationFunctions || false);
        if (validatedConfig.transformationFunction) {
            try {
                this.transformationFunction = new Script(validatedConfig.transformationFunction);
            } catch (ex) {
                await this.messageClient.sendMatrixText(this.roomId, 'Could not compile transformation function:' + ex);
            }
        }
        this.state = validatedConfig;
    }

    public transformHookData(data: Record<string, unknown>): string {
        // Supported parameters https://developers.mattermost.com/integrate/incoming-webhooks/#parameters
        let msg = "";
        if (typeof data.username === "string") {
            // Create a matrix user for this person
            msg += `**${data.username}**: `
        }
        if (typeof data.text === "string") {
            msg += data.text;
        } else {
            msg += `Recieved webhook data:\n\n\`\`\`${JSON.stringify(data, undefined, 2)}\`\`\``;
        }

        // TODO: Transform Slackdown into markdown.
        return msg;
    }

    public async onGenericHook(data: Record<string, unknown>) {
        log.info(`onGenericHook ${this.roomId} ${this.hookId}`);
        let content: string;
        if (!this.transformationFunction) {
            content = this.transformHookData(data);
        } else {
            try {
                const context = createContext({data});
                this.transformationFunction.runInContext(context, {
                    timeout: TRANSFORMATION_TIMEOUT_MS,
                    breakOnSigint: true,
                    filename: `generic-hook.${this.hookId}`,
                });
                if (context.result) {
                    content = `Recieved webhook: ${context.result}`;
                } else {
                    content = `No content`;
                }
            } catch (ex) {
                content = `Webhook recieved but failed to process via transformation function`;
            }
        }

        const sender = this.getUserId();
        await this.ensureDisplayname();

        return this.messageClient.sendMatrixMessage(this.roomId, {
            msgtype: "m.notice",
            body: content,
            formatted_body: md.renderInline(content),
            format: "org.matrix.custom.html",
            "uk.half-shot.webhook_data": data,
        }, 'm.room.message', sender);

    }

    public static getProvisionerDetails(botUserId: string) {
        return {
            service: "generic",
            eventType: GenericHookConnection.CanonicalEventType,
            type: "Webhook",
            // TODO: Add ability to configure the bot per connnection type.
            botUserId: botUserId,
        }
    }

    public getProvisionerDetails() {
        const url = `${this.config.urlPrefix}${this.config.urlPrefix.endsWith('/') ? '' : '/'}${this.hookId}`;
        return {
            ...GenericHookConnection.getProvisionerDetails(this.as.botUserId),
            id: this.connectionId,
            config: {
                transformationFunction: this.transformationFunction,
                hookId: this.hookId,
                name: this.state.name,
                url,
            },
        }
    }

    public async onRemove() {
        log.info(`Removing ${this.toString()} for ${this.roomId}`);
        // Do a sanity check that the event exists.
        try {
            await this.as.botClient.getRoomStateEvent(this.roomId, GenericHookConnection.CanonicalEventType, this.stateKey);
            await this.as.botClient.sendStateEvent(this.roomId, GenericHookConnection.CanonicalEventType, this.stateKey, { disabled: true });
        } catch (ex) {
            await this.as.botClient.getRoomStateEvent(this.roomId, GenericHookConnection.LegacyCanonicalEventType, this.stateKey);
            await this.as.botClient.sendStateEvent(this.roomId, GenericHookConnection.LegacyCanonicalEventType, this.stateKey, { disabled: true });
        }
        await GenericHookConnection.ensureRoomAccountData(this.roomId, this.as, this.hookId, this.stateKey, true);
    }

    public async provisionerUpdateConfig(userId: string, config: Record<string, unknown>) {
        const validatedConfig = GenericHookConnection.validateState(config, this.config.allowJsTransformationFunctions || false);
        await this.as.botClient.sendStateEvent(this.roomId, GenericHookConnection.CanonicalEventType, this.stateKey, 
            {
                ...validatedConfig,
                hookId: this.hookId
            }
        );
    }

    public toString() {
        return `GenericHookConnection ${this.hookId}`;
    }
}