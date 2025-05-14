import axios, { isAxiosError } from "axios";
import { BaseConnection } from "./BaseConnection";
import { Connection, IConnection, IConnectionState, InstantiateConnectionOpts, ProvisionConnectionOpts } from "./IConnection";
import { ApiError, ErrCode, Logger } from "matrix-appservice-bridge";
import { MatrixEvent } from "../MatrixEvent";
import { FileMessageEventContent, Intent, StateEvent } from "matrix-bot-sdk";
import { randomUUID } from "crypto";
import UserAgent from "../UserAgent";
import { hashId } from "../libRs";
import { GetConnectionsResponseItem } from "../provisioning/api";

export interface OutboundHookConnectionState extends IConnectionState {
    name: string,
    url: string;
    method?: "PUT"|"POST";
}

export interface OutboundHookSecrets {
    token: string;
}

export type OutboundHookResponseItem = GetConnectionsResponseItem<OutboundHookConnectionState, OutboundHookSecrets>;


const log = new Logger("OutboundHookConnection");

/**
 * Handles rooms connected to an outbound generic service.
 */
@Connection
export class OutboundHookConnection extends BaseConnection implements IConnection {
    static readonly CanonicalEventType = "uk.half-shot.matrix-hookshot.outbound-hook";
    static readonly ServiceCategory = "genericOutbound";

    static readonly EventTypes = [
        OutboundHookConnection.CanonicalEventType,
    ];
    
    private static getAccountDataKey(stateKey: string) {
        return `${OutboundHookConnection.CanonicalEventType}:${stateKey}`;
    }

    static validateState(state: Record<string, unknown>): OutboundHookConnectionState {
        const {url, method, name} = state;
        if (typeof url !== "string") {
            throw new ApiError('Outbound URL must be a string', ErrCode.BadValue);
        }

        if (typeof name !== "string") {
            throw new ApiError("A webhook name must be a string.", ErrCode.BadValue);
        }

        try {
            const validatedUrl = new URL(url);
            if (validatedUrl.protocol !== "http:" && validatedUrl.protocol !== "https:") {
                throw new ApiError('Outbound URL protocol must be http or https', ErrCode.BadValue);
            }
        } catch (ex) {
            if (ex instanceof ApiError) {
                throw ex;
            }
            throw new ApiError('Outbound URL is invalid', ErrCode.BadValue);
        }

        if (method === "PUT" || method === "POST" || method === undefined) {
            return {
                name,
                url,
                method: method ?? 'PUT',
            };
        }
        throw new ApiError('Outbound Method must be one of PUT,POST', ErrCode.BadValue);
    }

    static async createConnectionForState(roomId: string, event: StateEvent<Record<string, unknown>>, {intent, config, tokenStore}: InstantiateConnectionOpts) {
        if (!config.generic) {
            throw Error('Generic webhooks are not configured');
        }
        // Generic hooks store the hookId in the account data
        const state = this.validateState(event.content);
        const token =  await tokenStore.getGenericToken("outboundHookToken", hashId(`${roomId}:${event.stateKey}`));

        if (!token) {
            throw new Error(`Missing stored token for connection`);
        }

        return new OutboundHookConnection(
            roomId,
            state,
            token,
            event.stateKey,
            intent,
        );
    }

    static async provisionConnection(roomId: string, userId: string, data: Record<string, unknown> = {}, {intent, config, tokenStore}: ProvisionConnectionOpts) {
        if (!config.generic) {
            throw Error('Generic Webhooks are not configured');
        }
        if (!config.generic.outbound) {
            throw Error('Outbound support for Generic Webhooks is not configured');
        }

        const token = `hs-ob-${randomUUID()}`;

        if (typeof data.name !== "string"  || data.name.length < 3 || data.name.length > 64) {
            throw new ApiError("A webhook name must be between 3-64 characters.", ErrCode.BadValue);
        }

        const validState = OutboundHookConnection.validateState(data);

        const stateKey = data.name;
        const tokenKey = hashId(`${roomId}:${stateKey}`);
        await tokenStore.storeGenericToken("outboundHookToken", tokenKey, token);

        await intent.underlyingClient.sendStateEvent(roomId, this.CanonicalEventType, stateKey, validState);
        const connection = new OutboundHookConnection(roomId, validState, token, stateKey, intent);
        return {
            connection,
            stateEventContent: validState,
        }
    }

    /**
     * @param state Should be a pre-validated state object returned by {@link validateState}
     */
    constructor(
        roomId: string,
        private state: OutboundHookConnectionState,
        public readonly outboundToken: string,
        stateKey: string,
        private readonly intent: Intent,
    ) {
        super(roomId, stateKey, OutboundHookConnection.CanonicalEventType);
    }

    public isInterestedInStateEvent(eventType: string, stateKey: string) {
        return OutboundHookConnection.EventTypes.includes(eventType) && this.stateKey === stateKey;
    }

    /**
     * Check for any embedded media in the event, and if present then extract it as a blob. This
     * function also returns event content with the encryption details stripped from the event contents.
     * @param ev The Matrix event to inspect for embedded media.
     * @returns A blob and event object if media is found, otherwise null.
     * @throws If media was expected (due to the msgtype) but not provided, or if the media could not
     *         be found or decrypted.
     */
    private async extractMedia(ev: MatrixEvent<unknown>): Promise<{blob: Blob, event: MatrixEvent<unknown>}|null> {
        // Check for non-extendable event types first.
        const content = ev.content as FileMessageEventContent;

        if (!["m.image", "m.audio", "m.file", "m.video"].includes(content.msgtype)) {
            return null;
        }

        const client = this.intent.underlyingClient;
        let data: { data: Buffer, contentType?: string};
        if (client.crypto && content.file) {
            data = {
                data: await client.crypto.decryptMedia(content.file),
                contentType: content.info?.mimetype
            };
            const strippedContent = {...ev, content: {
                ...content,
                file: null,
            }};
            return {
                blob: new File([await client.crypto.decryptMedia(content.file)], content.body, { type: data.contentType }),
                event: strippedContent
            }
        } else if (content.url) {
            data = await this.intent.underlyingClient.downloadContent(content.url);
            return {
                blob: new File([data.data], content.body, { type: data.contentType }),
                event: ev,
            };
        }

        throw Error('Missing file or url key on event, not handling media');
    }


    public async onEvent(ev: MatrixEvent<unknown>): Promise<void> {
        // The event content first.
        const multipartBlob = new FormData();
        try {
            const mediaResult = await this.extractMedia(ev);
            if (mediaResult) {
                multipartBlob.set('event', new Blob([JSON.stringify(mediaResult?.event)], {
                    type: 'application/json',
                }), "event_data.json");
                multipartBlob.set('media', mediaResult.blob);
            }
        } catch (ex) {
            log.warn(`Failed to get media for ${ev.event_id} in ${this.roomId}`, ex);
        }

        if (!multipartBlob.has('event')) {
            multipartBlob.set('event', new Blob([JSON.stringify(ev)], {
                type: 'application/json',
            }), "event_data.json");
        }

        try {
            await axios.request({
                url: this.state.url,
                data: multipartBlob,
                method: this.state.method,
                responseType: 'text',
                validateStatus: (status) => status >= 200 && status <= 299,
                headers: {
                    'User-Agent': UserAgent,
                    'X-Matrix-Hookshot-RoomId': this.roomId,
                    'X-Matrix-Hookshot-EventId': ev.event_id,
                    'X-Matrix-Hookshot-Token': this.outboundToken,
                },
            });
            log.info(`Sent webhook for ${ev.event_id}`);
        } catch (ex) {
            if (!isAxiosError(ex)) {
                log.error(`Failed to send outbound webhook`, ex);
                throw ex;
            }
            if (ex.status) {
                log.error(`Failed to send outbound webhook: HTTP ${ex.status}`);
            } else {
                log.error(`Failed to send outbound webhook: ${ex.code}`);
            }
            log.debug("Response from server", ex.response?.data);
        }
    }

    public static getProvisionerDetails(botUserId: string) {
        return {
            service: "genericOutbound",
            eventType: OutboundHookConnection.CanonicalEventType,
            type: "Webhook",
            botUserId: botUserId,
        }
    }

    public getProvisionerDetails(showSecrets = false): OutboundHookResponseItem {
        return {
            ...OutboundHookConnection.getProvisionerDetails(this.intent.userId),
            id: this.connectionId,
            config: {
                url: this.state.url,
                method: this.state.method,
                name: this.state.name,
            },
            ...(showSecrets ? { secrets: {
                token: this.outboundToken,
            } satisfies OutboundHookSecrets} : undefined)
        }
    }

    public async onRemove() {
        log.info(`Removing ${this.toString()} for ${this.roomId}`);
        // Do a sanity check that the event exists.
        await this.intent.underlyingClient.getRoomStateEvent(this.roomId, OutboundHookConnection.CanonicalEventType, this.stateKey);
        await this.intent.underlyingClient.sendStateEvent(this.roomId, OutboundHookConnection.CanonicalEventType, this.stateKey, { disabled: true });
        // TODO: Remove token

    }

    public async provisionerUpdateConfig(userId: string, config: Record<string, unknown>) {
        config = { ...this.state, ...config };
        const validatedConfig = OutboundHookConnection.validateState(config);
        await this.intent.underlyingClient.sendStateEvent(this.roomId, OutboundHookConnection.CanonicalEventType, this.stateKey,
            {
                ...validatedConfig,
            }
        );
        this.state = validatedConfig;
    }

    public toString() {
        return `OutboundHookConnection ${this.roomId}`;
    }
}