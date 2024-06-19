import { Connection, IConnection, IConnectionState, InstantiateConnectionOpts, ProvisionConnectionOpts } from "./IConnection";
import { Logger } from "matrix-appservice-bridge";
import { MessageSenderClient } from "../MatrixSender"
import markdownit from "markdown-it";
import { QuickJSWASMModule, newQuickJSWASMModule, shouldInterruptAfterDeadline } from "quickjs-emscripten";
import { MatrixEvent } from "../MatrixEvent";
import { Appservice, Intent, StateEvent } from "matrix-bot-sdk";
import { ApiError, ErrCode } from "../api";
import { BaseConnection } from "./BaseConnection";
import { GetConnectionsResponseItem } from "../provisioning/api";
import { BridgeConfigGenericWebhooks } from "../config/Config";
import { ensureUserIsInRoom } from "../IntentUtils";
import { randomUUID } from 'node:crypto';

export interface GenericHookConnectionState extends IConnectionState {
    /**
     * This is ONLY used for display purposes, but the account data value is used to prevent misuse.
     */
    hookId?: string;
    /**
     * The name given in the provisioning UI and displaynames.
     */
    name: string;
    transformationFunction: string|undefined;
    /**
     * Should the webhook only respond on completion.
     */
    waitForComplete: boolean|undefined;
}

export interface GenericHookSecrets {
    /**
     * The public URL for the webhook.
     */
    url: URL;
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

export interface WebhookResponse {
    body: string;
    contentType?: string;
    statusCode?: number;
}

interface WebhookTransformationResult {
    version: string;
    plain?: string;
    html?: string;
    msgtype?: string;
    empty?: boolean;
    webhookResponse?: WebhookResponse;
}

const log = new Logger("GenericHookConnection");
const md = new markdownit();

const TRANSFORMATION_TIMEOUT_MS = 500;
const SANITIZE_MAX_DEPTH = 10;
const SANITIZE_MAX_BREADTH = 50;

/**
 * Handles rooms connected to a generic webhook.
 */
@Connection
export class GenericHookConnection extends BaseConnection implements IConnection {
    private static quickModule?: QuickJSWASMModule;

    public static async initialiseQuickJS() {
        GenericHookConnection.quickModule = await newQuickJSWASMModule();
    }

    /**
     * Ensures a JSON payload is compatible with Matrix JSON requirements, such
     * as disallowing floating point values.
     *
     * If the `depth` exceeds `SANITIZE_MAX_DEPTH`, the value of `data` will be immediately returned.
     * If the object contains more than `SANITIZE_MAX_BREADTH` entries, the remaining entries will not be checked.
     *
     * @param data The data to santise
     * @param depth The depth of the `data` relative to the root.
     * @param breadth The breadth of the `data` in the parent object.
     * @returns
     */
    static sanitiseObjectForMatrixJSON(data: unknown, depth = 0, breadth = 0): unknown {
        // Floats
        if (typeof data === "number" && !Number.isInteger(data)) {
            return data.toString();
        }
        // Primitive types
        if (typeof data !== "object" || data === null) {
            return data;
        }

        // Over processing limit, return string.
        if (depth > SANITIZE_MAX_DEPTH || breadth > SANITIZE_MAX_BREADTH) {
            return JSON.stringify(data);
        }

        const newDepth = depth + 1;
        if (Array.isArray(data)) {
            return data.map((d, innerBreadth) => this.sanitiseObjectForMatrixJSON(d, newDepth, innerBreadth));
        }

        let objBreadth = 0;
        const obj: Record<string, unknown> = { ...data };
        for (const [key, value] of Object.entries(data)) {
            obj[key] = this.sanitiseObjectForMatrixJSON(value, newDepth, ++objBreadth);
        }

        return obj;
    }

    static validateState(state: Record<string, unknown>): GenericHookConnectionState {
        const {name, transformationFunction, waitForComplete} = state;
        if (!name) {
            throw new ApiError('Missing name', ErrCode.BadValue);
        }
        if (typeof name !== "string" || name.length < 3 || name.length > 64) {
            throw new ApiError("'name' must be a string between 3-64 characters long", ErrCode.BadValue);
        }
        if (waitForComplete !== undefined && typeof waitForComplete !== "boolean") {
            throw new ApiError("'waitForComplete' must be a boolean", ErrCode.BadValue);
        }
        // Use !=, not !==, to check for both undefined and null
        if (transformationFunction != undefined) {
            if (!this.quickModule) {
                throw new ApiError('Transformation functions are not allowed', ErrCode.DisabledFeature);
            }
            if (typeof transformationFunction !== "string") {
                throw new ApiError('Transformation functions must be a string', ErrCode.BadValue);
            }
        }
        return {
            name,
            transformationFunction: transformationFunction || undefined,
            waitForComplete,
        };
    }

    static async createConnectionForState(roomId: string, event: StateEvent<Record<string, unknown>>, {as, intent, config, messageClient}: InstantiateConnectionOpts) {
        if (!config.generic) {
            throw Error('Generic webhooks are not configured');
        }
        // Generic hooks store the hookId in the account data
        const acctData = await intent.underlyingClient.getSafeRoomAccountData<GenericHookAccountData>(GenericHookConnection.CanonicalEventType, roomId, {});
        const state = this.validateState(event.content);
        // hookId => stateKey
        let hookId = Object.entries(acctData).find(([, v]) => v === event.stateKey)?.[0];
        if (!hookId) {
            hookId = randomUUID();
            log.warn(`hookId for ${roomId} not set in accountData, setting to ${hookId}`);
            await GenericHookConnection.ensureRoomAccountData(roomId, intent, hookId, event.stateKey);
        }

        return new GenericHookConnection(
            roomId,
            state,
            hookId,
            event.stateKey,
            messageClient,
            config.generic,
            as,
            intent,
        );
    }

    static async provisionConnection(roomId: string, userId: string, data: Record<string, unknown> = {}, {as, intent, config, messageClient}: ProvisionConnectionOpts) {
        if (!config.generic) {
            throw Error('Generic Webhooks are not configured');
        }
        const hookId = randomUUID();
        const validState = GenericHookConnection.validateState(data);
        await GenericHookConnection.ensureRoomAccountData(roomId, intent, hookId, validState.name);
        await intent.underlyingClient.sendStateEvent(roomId, this.CanonicalEventType, validState.name, validState);
        const connection = new GenericHookConnection(roomId, validState, hookId, validState.name, messageClient, config.generic, as, intent);
        return {
            connection,
            stateEventContent: validState,
        }
    }

    /**
     * This function ensures the account data for a room contains all the hookIds for the various state events.
     */
    static async ensureRoomAccountData(roomId: string, intent: Intent, hookId: string, stateKey: string, remove = false) {
        const data = await intent.underlyingClient.getSafeRoomAccountData<GenericHookAccountData>(GenericHookConnection.CanonicalEventType, roomId, {});
        if (remove && data[hookId] === stateKey) {
            delete data[hookId];
            await intent.underlyingClient.setRoomAccountData(GenericHookConnection.CanonicalEventType, roomId, data);
        }
        if (!remove && data[hookId] !== stateKey) {
            data[hookId] = stateKey;
            await intent.underlyingClient.setRoomAccountData(GenericHookConnection.CanonicalEventType, roomId, data);
        }
    }

    static readonly CanonicalEventType = "uk.half-shot.matrix-hookshot.generic.hook";
    static readonly LegacyCanonicalEventType = "uk.half-shot.matrix-github.generic.hook";
    static readonly ServiceCategory = "generic";

    static readonly EventTypes = [
        GenericHookConnection.CanonicalEventType,
        GenericHookConnection.LegacyCanonicalEventType,
    ];

    private transformationFunction?: string;
    private cachedDisplayname?: string;
    /**
     * @param state Should be a pre-validated state object returned by {@link validateState}
     */
    constructor(
        roomId: string,
        private state: GenericHookConnectionState,
        public readonly hookId: string,
        stateKey: string,
        private readonly messageClient: MessageSenderClient,
        private readonly config: BridgeConfigGenericWebhooks,
        private readonly as: Appservice,
        private readonly intent: Intent,
    ) {
        super(roomId, stateKey, GenericHookConnection.CanonicalEventType);
        if (state.transformationFunction && GenericHookConnection.quickModule) {
            this.transformationFunction = state.transformationFunction;
        }
    }

    /**
     * Should the webhook handler wait for this to finish before
     * sending a response back.
     */
    public get waitForComplete(): boolean {
        return this.state.waitForComplete ?? false;
    }

    public get priority(): number {
        return this.state.priority || super.priority;
    }

    public isInterestedInStateEvent(eventType: string, stateKey: string) {
        return GenericHookConnection.EventTypes.includes(eventType) && this.stateKey === stateKey;
    }

    public getUserId() {
        if (!this.config.userIdPrefix) {
            return this.intent.userId;
        }
        const [, domain] = this.intent.userId.split(':');
        const name = this.state.name &&
             this.state.name.replace(/[A-Z]/g, (s) => s.toLowerCase()).replace(/([^a-z0-9\-.=_]+)/g, '');
        return `@${this.config.userIdPrefix}${name || 'bot'}:${domain}`;
    }

    public async ensureDisplayname(intent: Intent) {
        if (!this.state.name) {
            return;
        }
        if (this.intent.userId === intent.userId) {
            // Don't set a displayname on the root bot user.
            return;
        }
        await intent.ensureRegistered();
        const expectedDisplayname = `${this.state.name} (Webhook)`;

        try {
            if (this.cachedDisplayname !== expectedDisplayname) {
                this.cachedDisplayname = (await intent.underlyingClient.getUserProfile(this.intent.userId)).displayname;
            }
        } catch (ex) {
            // Couldn't fetch, probably not set.
            this.cachedDisplayname = undefined;
        }
        if (this.cachedDisplayname !== expectedDisplayname) {
            await intent.underlyingClient.setDisplayName(`${this.state.name} (Webhook)`);
            this.cachedDisplayname = expectedDisplayname;
        }
    }

    public async onStateUpdate(stateEv: MatrixEvent<unknown>) {
        const validatedConfig = GenericHookConnection.validateState(stateEv.content as Record<string, unknown>);
        if (validatedConfig.transformationFunction) {
            const ctx = GenericHookConnection.quickModule!.newContext();
            const codeEvalResult = ctx.evalCode(`function f(data) {${validatedConfig.transformationFunction}}`, undefined, { compileOnly: true });
            if (codeEvalResult.error) {
                const errorString = JSON.stringify(ctx.dump(codeEvalResult.error), null, 2);
                codeEvalResult.error.dispose();
                ctx.dispose();

                const errorPrefix = "Could not compile transformation function:";
                await this.intent.sendEvent(this.roomId, {
                    msgtype: "m.text",
                    body: errorPrefix + "\n\n```json\n\n" + errorString + "\n\n```",
                    formatted_body: `<p>${errorPrefix}</p><p><pre><code class=\\"language-json\\">${errorString}</code></pre></p>`,
                    format: "org.matrix.custom.html",
                });
            } else {
                codeEvalResult.value.dispose();
                ctx.dispose();
                this.transformationFunction = validatedConfig.transformationFunction;
            }
        } else {
            this.transformationFunction = undefined;
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
            const dataString = JSON.stringify(data, null, 2);
            const dataPrefix = "Received webhook data:";
            msg.plain = dataPrefix + "\n\n```json\n\n" + dataString + "\n\n```";
            msg.html = `<p>${dataPrefix}</p><p><pre><code class=\\"language-json\\">${dataString}</code></pre></p>`
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

    public executeTransformationFunction(data: unknown): {content?: {plain: string, html?: string, msgtype?: string}, webhookResponse?: WebhookResponse} {
        if (!this.transformationFunction) {
            throw Error('Transformation function not defined');
        }
        let result;
        const ctx = GenericHookConnection.quickModule!.newContext();
        ctx.runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + TRANSFORMATION_TIMEOUT_MS));
        try {
            ctx.setProp(ctx.global, 'HookshotApiVersion', ctx.newString('v2'));
            const ctxResult = ctx.evalCode(`const data = ${JSON.stringify(data)};\n(() => { ${this.state.transformationFunction} })();`);

            if (ctxResult.error) {
                const e = Error(`Transformation failed to run: ${JSON.stringify(ctx.dump(ctxResult.error))}`);
                ctxResult.error.dispose();
                throw e;
            } else {
                const value = ctx.getProp(ctx.global, 'result');
                result = ctx.dump(value);
                value.dispose();
                ctxResult.value.dispose();
            }
        } finally {
            ctx.global.dispose();
            ctx.dispose();
        }

        // Legacy v1 api
        if (typeof result === "string") {
            return {content: {plain: `Received webhook: ${result}`}};
        } else if (typeof result !== "object") {
            return {content: {plain: `No content`}};
        }
        const transformationResult = result as WebhookTransformationResult;
        if (transformationResult.version !== "v2") {
            throw Error("Result returned from transformation didn't specify version = v2");
        }

        let content;
        if (!transformationResult.empty) {
            if (typeof transformationResult.plain !== "string") {
                throw Error("Result returned from transformation didn't provide a string value for plain");
            }
            if (transformationResult.html !== undefined && typeof transformationResult.html !== "string") {
                throw Error("Result returned from transformation didn't provide a string value for html");
            }
            if (transformationResult.msgtype !== undefined && typeof transformationResult.msgtype !== "string") {
                throw Error("Result returned from transformation didn't provide a string value for msgtype");
            }
            content = {
                plain: transformationResult.plain,
                html: transformationResult.html,
                msgtype: transformationResult.msgtype,
            };
        }

        if (transformationResult.webhookResponse) {
            if (typeof transformationResult.webhookResponse.body !== "string") {
                throw Error("Result returned from transformation didn't provide a string value for webhookResponse.body");
            }
            if (transformationResult.webhookResponse.statusCode !== undefined && typeof transformationResult.webhookResponse.statusCode !== "number" && Number.isInteger(transformationResult.webhookResponse.statusCode)) {
                throw Error("Result returned from transformation didn't provide a number value for webhookResponse.statusCode");
            }
            if (transformationResult.webhookResponse.contentType !== undefined && typeof transformationResult.webhookResponse.contentType !== "string") {
                throw Error("Result returned from transformation didn't provide a contentType value for msgtype");
            }
        }

        return {
            content,
            webhookResponse: transformationResult.webhookResponse,
        }
    }

    /**
     * Processes an incoming generic hook
     * @param data Structured data. This may either be a string, or an object.
     * @returns `true` if the webhook completed, or `false` if it failed to complete
     */
    public async onGenericHook(data: unknown): Promise<{successful: boolean, response?: WebhookResponse}> {
        log.info(`onGenericHook ${this.roomId} ${this.hookId}`);
        let content: {plain: string, html?: string, msgtype?: string}|undefined;
        let webhookResponse: WebhookResponse|undefined;
        let successful = true;
        if (!this.transformationFunction) {
            content = this.transformHookData(data);
        } else {
            try {
                const result = this.executeTransformationFunction(data);
                content = result.content;
                webhookResponse = result.webhookResponse;
            } catch (ex) {
                log.warn(`Failed to run transformation function`, ex);
                content = {plain: `Webhook received but failed to process via transformation function`};
                successful = false;
            }
        }

        if (content) {
            const sender = this.getUserId();
            const senderIntent = this.as.getIntentForUserId(sender);
            await this.ensureDisplayname(senderIntent);
    
            await ensureUserIsInRoom(senderIntent, this.intent.underlyingClient, this.roomId);
    
            // Matrix cannot handle float data, so make sure we parse out any floats.
            const safeData = GenericHookConnection.sanitiseObjectForMatrixJSON(data);
    
            await this.messageClient.sendMatrixMessage(this.roomId, {
                msgtype: content.msgtype || "m.notice",
                body: content.plain,
                // render can output redundant trailing newlines, so trim it.
                formatted_body: content.html || md.render(content.plain).trim(),
                format: "org.matrix.custom.html",
                "uk.half-shot.hookshot.webhook_data": safeData,
            }, 'm.room.message', sender);
        }

        return {
            successful,
            response: webhookResponse,
        };
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
            ...GenericHookConnection.getProvisionerDetails(this.intent.userId),
            id: this.connectionId,
            config: {
                transformationFunction: this.state.transformationFunction,
                waitForComplete: this.waitForComplete,
                name: this.state.name,
            },
            ...(showSecrets ? { secrets: {
                url: new URL(this.hookId, this.config.parsedUrlPrefix),
                hookId: this.hookId,
            } satisfies GenericHookSecrets} : undefined)
        }
    }

    public async onRemove() {
        log.info(`Removing ${this.toString()} for ${this.roomId}`);
        // Do a sanity check that the event exists.
        try {
            await this.intent.underlyingClient.getRoomStateEvent(this.roomId, GenericHookConnection.CanonicalEventType, this.stateKey);
            await this.intent.underlyingClient.sendStateEvent(this.roomId, GenericHookConnection.CanonicalEventType, this.stateKey, { disabled: true });
        } catch (ex) {
            await this.intent.underlyingClient.getRoomStateEvent(this.roomId, GenericHookConnection.LegacyCanonicalEventType, this.stateKey);
            await this.intent.underlyingClient.sendStateEvent(this.roomId, GenericHookConnection.LegacyCanonicalEventType, this.stateKey, { disabled: true });
        }
        await GenericHookConnection.ensureRoomAccountData(this.roomId, this.intent, this.hookId, this.stateKey, true);
    }

    public async provisionerUpdateConfig(userId: string, config: Record<string, unknown>) {
        // Apply previous state to the current config, as provisioners might not return "unknown" keys.
        config = { ...this.state, ...config };
        const validatedConfig = GenericHookConnection.validateState(config);
        await this.intent.underlyingClient.sendStateEvent(this.roomId, GenericHookConnection.CanonicalEventType, this.stateKey,
            {
                ...validatedConfig,
                hookId: this.hookId
            }
        );
        this.state = validatedConfig;
    }

    public toString() {
        return `GenericHookConnection ${this.hookId}`;
    }
}
