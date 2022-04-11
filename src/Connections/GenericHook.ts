import { IConnection, IConnectionState } from "./IConnection";
import LogWrapper from "../LogWrapper";
import { MessageSenderClient } from "../MatrixSender"
import markdownit from "markdown-it";
import { VMScript as Script, NodeVM } from "vm2";
import { MatrixEvent } from "../MatrixEvent";
import { Appservice } from "matrix-bot-sdk";
import { v4 as uuid} from "uuid";
import { ApiError, ErrCode } from "../api";
import { BaseConnection } from "./BaseConnection";
import { GetConnectionsResponseItem } from "../provisioning/api";
import { BridgeConfigGenericWebhooks } from "../Config/Config";
export interface GenericHookConnectionState extends IConnectionState {
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

export interface GenericHookSecrets {
    /**
     * The public URL for the webhook.
     */
    url: string;
    /**
     * The hookId of the webhook.
     */
    hookId: string;
}

export type GenericHookResponseItem = GetConnectionsResponseItem<GenericHookConnectionState, GenericHookSecrets>;

/** */
export interface GenericHookAccountData {
    /**
     * This is where the true hook ID is kept. Each hook ID maps to a state_key.
     */
    [hookId: string]: string;
}

interface WebhookTransformationResult {
    version: string;
    plain?: string;
    html?: string;
    msgtype?: string;
    empty?: boolean;
}

const log = new LogWrapper("GenericHookConnection");
const md = new markdownit();

const TRANSFORMATION_TIMEOUT_MS = 500;

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

    static async provisionConnection(roomId: string, as: Appservice, data: Record<string, unknown> = {}, config: BridgeConfigGenericWebhooks, messageClient: MessageSenderClient) {
        const hookId = uuid();
        const validState: GenericHookConnectionState = {
            ...GenericHookConnection.validateState(data, config.allowJsTransformationFunctions || false),
            hookId,
        };
        const connection = new GenericHookConnection(roomId, validState, hookId, validState.name, messageClient, config, as);
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
        private readonly config: BridgeConfigGenericWebhooks,
        private readonly as: Appservice) {
            super(roomId, stateKey, GenericHookConnection.CanonicalEventType);
            if (state.transformationFunction && config.allowJsTransformationFunctions) {
                this.transformationFunction = new Script(state.transformationFunction);
            }
        }

        public get priority(): number {
            return this.state.priority || super.priority;
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
        if (sender === this.as.botUserId) {
            // Don't set the global displayname for the bot.
            return;   
        }
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

    public transformHookData(data: unknown): {plain: string, html?: string} {
        // Supported parameters https://developers.mattermost.com/integrate/incoming-webhooks/#parameters
        const msg: {plain: string, html?: string} = {plain: ""};
        const safeData = typeof data === "object" && data !== null ? data as Record<string, unknown> : undefined;
        if (typeof data === "string") {
            return {plain: `Received webhook data: ${data}`};
        } else if (typeof safeData?.text === "string") {
            msg.plain = safeData.text;
        } else {
            msg.plain = "Received webhook data:\n\n" + "```json\n\n" + JSON.stringify(data, null, 2) + "\n\n```";
            msg.html = `<p>Received webhook data:</p><p><pre><code class=\\"language-json\\">${JSON.stringify(data, null, 2)}</code></pre></p>`
        }

        if (typeof safeData?.html === "string") {
            msg.html = safeData.html;
        }

        if (typeof safeData?.username === "string") {
            // Create a matrix user for this person
            msg.plain = `**${safeData.username}**: ${msg.plain}`
            if (msg.html) {
                msg.html = `<strong>${safeData.username}</strong>: ${msg.html}`;
            }
        }
        // TODO: Transform Slackdown into markdown.
        return msg;
    }

    public executeTransformationFunction(data: unknown): {plain: string, html?: string, msgtype?: string}|null {
        if (!this.transformationFunction) {
            throw Error('Transformation function not defined');
        }
        const vm = new NodeVM({
            console: 'off',
            wrapper: 'none',
            wasm: false,
            eval: false,
            timeout: TRANSFORMATION_TIMEOUT_MS,
        });
        vm.setGlobal('HookshotApiVersion', 'v2');
        vm.setGlobal('data', data);
        vm.run(this.transformationFunction);
        const result = vm.getGlobal('result');

        // Legacy v1 api
        if (typeof result === "string") {
            return {plain: `Received webhook: ${result}`};
        } else if (typeof result !== "object") {
            return {plain: `No content`};
        }
        const transformationResult = result as WebhookTransformationResult;
        if (transformationResult.version !== "v2") {
            throw Error("Result returned from transformation didn't specify version = v2");
        }

        if (transformationResult.empty) {
            return null; // No-op
        }

        const plain = transformationResult.plain;
        if (typeof plain !== "string") {
            throw Error("Result returned from transformation didn't provide a string value for plain");
        }
        if (transformationResult.html && typeof transformationResult.html !== "string") {
            throw Error("Result returned from transformation didn't provide a string value for html");
        }
        if (transformationResult.msgtype && typeof transformationResult.msgtype !== "string") {
            throw Error("Result returned from transformation didn't provide a string value for msgtype");
        }

        return {
            plain: plain,
            html: transformationResult.html,
            msgtype: transformationResult.msgtype,
        }
    }

    /**
     * Processes an incoming generic hook
     * @param data Structured data. This may either be a string, or an object.
     * @returns `true` if the webhook completed, or `false` if it failed to complete 
     */
    public async onGenericHook(data: unknown): Promise<boolean> {
        log.info(`onGenericHook ${this.roomId} ${this.hookId}`);
        let content: {plain: string, html?: string, msgtype?: string};
        let success = true;
        if (!this.transformationFunction) {
            content = this.transformHookData(data);
        } else {
            try {
                const potentialContent = this.executeTransformationFunction(data);
                if (potentialContent === null) {
                    // Explitly no action
                    return true;
                }
                content = potentialContent;
            } catch (ex) {
                log.warn(`Failed to run transformation function`, ex);
                content = {plain: `Webhook received but failed to process via transformation function`};
                success = false;
            }
        }

        const sender = this.getUserId();
        await this.ensureDisplayname();

        await this.messageClient.sendMatrixMessage(this.roomId, {
            msgtype: content.msgtype || "m.notice",
            body: content.plain,
            formatted_body: content.html || md.renderInline(content.plain),
            format: "org.matrix.custom.html",
            "uk.half-shot.hookshot.webhook_data": data,
        }, 'm.room.message', sender);
        return success;

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

    public getProvisionerDetails(showSecrets = false): GenericHookResponseItem {
        return {
            ...GenericHookConnection.getProvisionerDetails(this.as.botUserId),
            id: this.connectionId,
            config: {
                transformationFunction: this.state.transformationFunction,
                name: this.state.name,
            },
            ...(showSecrets ? { secrets: {
                url: `${this.config.urlPrefix}${this.config.urlPrefix.endsWith('/') ? '' : '/'}${this.hookId}`,
                hookId: this.hookId,
            } as GenericHookSecrets} : undefined)
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
