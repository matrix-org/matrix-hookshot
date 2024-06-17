import axios, { isAxiosError } from "axios";
import { BridgeConfigGenericWebhooks } from "../config/Config";
import { BaseConnection } from "./BaseConnection";
import { Connection, IConnection, InstantiateConnectionOpts, ProvisionConnectionOpts } from "./IConnection";
import { ApiError, ErrCode, Logger } from "matrix-appservice-bridge";
import { MatrixEvent } from "../MatrixEvent";
import { UserTokenStore } from "../tokens/UserTokenStore";
import { FileMessageEventContent, Intent, StateEvent } from "matrix-bot-sdk";
import { randomUUID } from "crypto";
import UserAgent from "../UserAgent";

export interface OutboundHookConnectionState {
    name: string,
    url: string;
    method?: "PUT"|"POST";
}

interface AccountData {
    token: string;
}

const log = new Logger("OutboundHookConnection");
/**
 * Handles rooms connected to a generic webhook.
 */
@Connection
export class OutboundHookConnection extends BaseConnection implements IConnection {
    static readonly CanonicalEventType = "uk.half-shot.matrix-hookshot.outbound-hook";
    static readonly ServiceCategory = "generic";

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
            // TODO: Allow this to be configurable?
            if (validatedUrl.protocol !== "http:" && validatedUrl.protocol !== "https:") {
                throw new ApiError('Outbound URL protocol must be http or https', ErrCode.BadValue);
            }
            // TODO: Block some origins
            // if (validatedUrl.origin !== "localhost") {
            //     throw new ApiError('Outbound URL origin is denied', ErrCode.BadValue);
            // }
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
        const acctData = await intent.underlyingClient.getRoomAccountData<AccountData>(
            this.getAccountDataKey(event.stateKey),
            roomId,
        );

        if (!acctData.token) {
            throw new Error('No token provided in account data for outbound connection');
        }

        return new OutboundHookConnection(
            roomId,
            state,
            acctData.token,
            event.stateKey,
            intent,
            config.generic,
            tokenStore,
        );
    }

    static async provisionConnection(roomId: string, userId: string, data: Record<string, unknown> = {}, {intent, config, tokenStore}: ProvisionConnectionOpts) {
        if (!config.generic) {
            throw Error('Generic Webhooks are not configured');
        }
        const token = randomUUID();

        if (typeof data.name !== "string"  || data.name.length < 3 || data.name.length > 64) {
            throw new ApiError("A webhook name must be between 3-64 characters.", ErrCode.BadValue);
        }

        const validState = OutboundHookConnection.validateState(data);
        intent.underlyingClient.setRoomAccountData(OutboundHookConnection.getAccountDataKey(validState.name), roomId, {
            token
        });
        await intent.underlyingClient.sendStateEvent(roomId, this.CanonicalEventType, validState.name, validState);
        const connection = new OutboundHookConnection(roomId, validState, token, validState.name, intent, config.generic, tokenStore);
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
        private readonly config: BridgeConfigGenericWebhooks,
        // TODO: Use this for hook token storage.
        private readonly storage: UserTokenStore,
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
                blob: new Blob([await client.crypto.decryptMedia(content.file)], { type: content.info?.mimetype }),
                event: strippedContent
            }
        } else if (content.url) {
            data = await this.intent.underlyingClient.downloadContent(content.url);
            return {
                blob: new Blob([data.data], { type: data.contentType }),
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
                    encoding: 'utf8',
                }), "event_data.json");
                multipartBlob.set('media', mediaResult.blob);
            }
        } catch (ex) {
            log.warn(`Failed to get media for ${ev.event_id} in ${this.roomId}`, ex);
        }

        if (!multipartBlob.has('event')) {
            multipartBlob.set('event', new Blob([JSON.stringify(ev)], {
                type: 'application/json',
                encoding: 'utf8',
            }), "event_data.json");
        }

        try {
            const req = await axios.request({
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
            
            // req.data.end();
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

    public toString() {
        return `OutboundHookConnection ${this.roomId}`;
    }
}