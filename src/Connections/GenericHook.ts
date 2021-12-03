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
    hookId: string;
    /**
     * The name given in the provisioning UI and displaynames.
     */
    name?: string;
    transformationFunction?: string;
}

export interface GenericHookAccountData {
    /**
     * This is where the true hook ID is kept.
     */
    hookId: string;
}

const log = new LogWrapper("GenericHookConnection");
const md = new markdownit();

const TRANSFORMATION_TIMEOUT_MS = 2000;

/**
 * Handles rooms connected to a github repo.
 */
export class GenericHookConnection extends BaseConnection implements IConnection {

    static async provisionConnection(roomId: string, as: Appservice, data: Record<string, unknown> = {}, config: BridgeGenericWebhooksConfig, messageClient: MessageSenderClient) {
        const hookId = uuid();
        const validState: GenericHookConnectionState = {
            hookId,
        };
        if (data.transformationFunction) {
            if (!config.allowJsTransformationFunctions) {
                throw new ApiError('Transformation functions are not allowed', ErrCode.DisabledFeature);
            }
            if (typeof data.transformationFunction !== "string") {
                throw new ApiError('Transformation functions must be a string', ErrCode.BadValue);
            }
            validState.transformationFunction = data.transformationFunction;
        }
        if (!data.name) {
            throw new ApiError('Missing name', ErrCode.BadValue);
        }
        if (typeof data.name !== "string" || data.name.length < 3 || data.name.length > 64) {
            throw new ApiError("'name' must be a string between 3-64 characters long", ErrCode.BadValue);
        }
        validState.name = data.name;
        const connection = new GenericHookConnection(roomId, validState, {hookId}, hookId, messageClient, config, as);
        await as.botClient.setRoomAccountData(roomId, GenericHookConnection.CanonicalEventType, {hookId}); 
        return {
            connection,
            stateEventContent: validState,
        }
    }

    static readonly CanonicalEventType = "uk.half-shot.matrix-hookshot.generic.hook";
    static readonly LegacyCanonicalEventType = "uk.half-shot.matrix-github.generic.hook";

    static readonly EventTypes = [
        GenericHookConnection.CanonicalEventType,
        GenericHookConnection.LegacyCanonicalEventType,
    ];

    public get hookId() {
        return this.accountData.hookId;
    }

    private transformationFunction?: Script;
    private cachedDisplayname?: string;

    constructor(roomId: string,
        private readonly state: GenericHookConnectionState,
        private readonly accountData: GenericHookAccountData,
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
        const state = stateEv.content as GenericHookConnectionState;
        if (state.transformationFunction && this.config.allowJsTransformationFunctions) {
            try {
                this.transformationFunction = new Script(state.transformationFunction);
            } catch (ex) {
                await this.messageClient.sendMatrixText(this.roomId, 'Could not compile transformation function:' + ex);
            }
        }
        this.state.name = state.name;
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

    public toString() {
        return `GenericHookConnection ${this.hookId}`;
    }
}