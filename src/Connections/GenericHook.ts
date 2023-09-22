import { Connection, IConnection, IConnectionState, InstantiateConnectionOpts, ProvisionConnectionOpts } from "./IConnection";
import { Logger } from "matrix-appservice-bridge";
import { MessageSenderClient } from "../MatrixSender"
import markdownit from "markdown-it";
import { QuickJSRuntime, QuickJSWASMModule, newQuickJSWASMModule } from "quickjs-emscripten";
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
    hookId: string;
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

interface WebhookTransformationResult {
    version: string;
    plain?: string;
    html?: string;
    msgtype?: string;
    empty?: boolean;
}

const log = new Logger("GenericHookConnection");
const md = new markdownit();

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

    static validateState(state: Record<string, unknown>): Omit<GenericHookConnectionState, "hookId"> {
        const {name, transformationFunction} = state;
        if (!name) {
            throw new ApiError('Missing name', ErrCode.BadValue);
        }
        if (typeof name !== "string" || name.length < 3 || name.length > 64) {
            throw new ApiError("'name' must be a string between 3-64 characters long", ErrCode.BadValue);
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
            ...(transformationFunction && {transformationFunction}),
        };
    }

    static async createConnectionForState(roomId: string, event: StateEvent<Record<string, unknown>>, {as, intent, config, messageClient}: InstantiateConnectionOpts) {
        if (!config.generic) {
            throw Error('Generic webhooks are not configured');
        }
        // Generic hooks store the hookId in the account data
        const acctData = await intent.underlyingClient.getSafeRoomAccountData<GenericHookAccountData>(GenericHookConnection.CanonicalEventType, roomId, {});
        // hookId => stateKey
        let hookId = Object.entries(acctData).find(([, v]) => v === event.stateKey)?.[0];
        if (!hookId) {
            hookId = randomUUID();
            log.warn(`hookId for ${roomId} not set in accountData, setting to ${hookId}`);
            await GenericHookConnection.ensureRoomAccountData(roomId, intent, hookId, event.stateKey);
        }

        return new GenericHookConnection(
            roomId,
            event.content,
            hookId,
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
        const connection = new GenericHookConnection(roomId, data, randomUUID(), messageClient, config.generic, as, intent);
        await GenericHookConnection.ensureRoomAccountData(roomId, intent, connection.state.hookId, connection.state.name);
        await intent.underlyingClient.sendStateEvent(roomId, this.CanonicalEventType, connection.state.name, connection.state);
        return {
            connection,
            stateEventContent: connection.state,
        }
    }

    /**
     * This function ensures the account data for a room contains all the hookIds for the various state events.
     */
    static async ensureRoomAccountData(roomId: string, intent: Intent, hookId: string, stateKey: string, remove = false) {
        const data = await intent.underlyingClient.getSafeRoomAccountData<GenericHookAccountData>(GenericHookConnection.CanonicalEventType, roomId, {});
        if (remove === (data[hookId] === stateKey)) {
            if (remove) {
                delete data[hookId];
            } else {
                data[hookId] = stateKey;
            }
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

    private state: GenericHookConnectionState;
    private hasValidTransformation = false;
    private cachedDisplayname?: string;
    constructor(
        roomId: string,
        stateContent: Record<string, unknown>,
        hookId: string,
        private readonly messageClient: MessageSenderClient,
        private readonly config: BridgeConfigGenericWebhooks,
        private readonly as: Appservice,
        private readonly intent: Intent,
    ) {
        const validState = GenericHookConnection.validateState(stateContent);
        super(roomId, validState.name, GenericHookConnection.CanonicalEventType);
        this.state = {
            ...validState,
            hookId,
        };
        void this.validateTransformationFunction();
    }

    public get hookId() {
        return this.state.hookId;
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

    public onStateUpdate(stateEv: MatrixEvent<unknown>) {
        return this.updateConfig(stateEv.content as Record<string, unknown>);
    }

    private async updateConfig(config: Record<string, unknown>) {
        this.state = {
            ...GenericHookConnection.validateState(config),
            hookId: this.state.hookId,
        };
        return this.validateTransformationFunction();
    }

    private validateTransformationFunction(): Promise<void> {
        let result = Promise.resolve();
        if (!GenericHookConnection.quickModule || !this.state.transformationFunction) {
            return result;
        }
        this.hasValidTransformation = false;
        const ctx = GenericHookConnection.quickModule.newContext();
        const codeEvalResult = ctx.evalCode(`function f(data) {${this.state.transformationFunction}}`);
        if (codeEvalResult.error) {
            const message = "Could not compile transformation function:\n```" + JSON.stringify(ctx.dump(codeEvalResult.error)) + "```";
            codeEvalResult.error.dispose();
            result = this.intent.sendEvent(this.roomId, {
                msgtype: "m.text",
                body: message,
                formatted_body: md.renderInline(message).replaceAll("\n", "<br>"),
                format: "org.matrix.custom.html",
            }).then();
        } else {
            this.hasValidTransformation = true;
            codeEvalResult.value.dispose();
        }
        ctx.dispose();
        return result;
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
        if (!GenericHookConnection.quickModule) {
            throw Error('Transformation runtime not defined');
        }
        let result;
        const ctx = GenericHookConnection.quickModule.newContext();
        try {
            ctx.setProp(ctx.global, 'HookshotApiVersion', ctx.newString('v2'));
            const ctxResult = ctx.evalCode(`const data = ${JSON.stringify(data)};\n\n${this.state.transformationFunction}`);

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
        log.info(`onGenericHook ${this.roomId} ${this.state.hookId}`);
        let content: {plain: string, html?: string, msgtype?: string};
        let success = true;
        if (!this.hasValidTransformation) {
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
            ...GenericHookConnection.getProvisionerDetails(this.intent.userId),
            id: this.connectionId,
            config: {
                transformationFunction: this.state.transformationFunction,
                name: this.state.name,
                hookId: this.state.hookId,
            },
            ...(showSecrets ? { secrets: {
                url: new URL(this.state.hookId, this.config.parsedUrlPrefix),
                hookId: this.state.hookId,
            } as GenericHookSecrets} : undefined)
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
        await GenericHookConnection.ensureRoomAccountData(this.roomId, this.intent, this.state.hookId, this.stateKey, true);
    }

    public async provisionerUpdateConfig(userId: string, config: Record<string, unknown>) {
        // Apply previous state to the current config, as provisioners might not return "unknown" keys.
        await this.updateConfig({ ...this.state, ...config });
        await this.intent.underlyingClient.sendStateEvent(this.roomId, GenericHookConnection.CanonicalEventType, this.stateKey, this.state);
    }

    public toString() {
        return `GenericHookConnection ${this.state.hookId}`;
    }
}
