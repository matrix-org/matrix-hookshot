import axios, { isAxiosError } from "axios";
import { BridgeConfigGenericWebhooks } from "../config/Config";
import { BaseConnection } from "./BaseConnection";
import { Connection, IConnection, InstantiateConnectionOpts, ProvisionConnectionOpts } from "./IConnection";
import { ApiError, ErrCode, Logger } from "matrix-appservice-bridge";
import { MatrixEvent } from "../MatrixEvent";
import { UserTokenStore } from "../tokens/UserTokenStore";
import { FileMessageEventContent, Intent, StateEvent } from "matrix-bot-sdk";
import { randomUUID } from "crypto";

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

    private async extractMedia(ev: MatrixEvent<unknown>): Promise<Blob|null> {
        // Check for non-extendable event types first.
        const content = ev.content as FileMessageEventContent;
        if (!["m.image", "m.audio", "m.file", "m.video"].includes(content.msgtype)) {
            return null;
        }
        // No URL in media message so we can't handle it.
        if (!content.url) {
            return null;
        }
        const trueUrl = this.intent.underlyingClient.mxcToHttp(content.url);
        const req = await fetch(trueUrl);
        if (req.status !== 200) {
            log.warn(`Failed to fetch media ${content.url} ${req.status} ${req.statusText}`);
            throw Error(`Failed to request media from server`);
        }
        return req.blob();
    }


    public async onEvent(ev: MatrixEvent<unknown>): Promise<void> {
        // The event content first.
        const multipartBlob = new FormData();
        const jsonBlob = new Blob([JSON.stringify(ev)], {
            type: 'application/json',
        });
        multipartBlob.set('event', jsonBlob, "event_data.json");
        try {
            const media = await this.extractMedia(ev);
            if (media) {
                multipartBlob.set('media', media);
            }
        } catch (ex) {
            log.warn(`Failed to get media for ${ev.event_id} in ${this.roomId}`, ex);
        }

        try {
            const req = await axios.request({
                url: this.state.url,
                data: multipartBlob,
                method: this.state.method,
                responseType: 'stream',
                validateStatus: (status) => status >= 200 && status <= 299,
                headers: {
                    'X-Matrix-Hookshot-EventId': ev.event_id,
                    'X-Matrix-Hookshot-Token': this.outboundToken,
                },
            });
            log.info(`Sent webhook for ${ev.event_id}`);
            
            req.data.end();
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