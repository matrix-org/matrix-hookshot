import { BridgeRoomState, GetAuthPollResponse, GetAuthResponse, GetConnectionsForServiceResponse } from '../src/Widgets/BridgeWidgetInterface';
import { GetConnectionsResponseItem } from "../src/provisioning/api";
import { ExchangeOpenAPIRequestBody, ExchangeOpenAPIResponseBody } from "matrix-appservice-bridge";
import { WidgetApi } from 'matrix-widget-api';
import { ApiError } from '../src/api';
import { FunctionComponent } from 'preact';
import { IConnectionState } from '../src/Connections';
export class BridgeAPIError extends Error {
    constructor(msg: string, public readonly body: ApiError) {
        super(msg);
    }

    public get errcode() {
        return this.body.errcode as string;
    }
    public get error() {
        return this.body.error as string;
    }
}

interface RequestOpts {
    abortController?: AbortController;
}

export class BridgeAPI {
    
    static async getBridgeAPI(baseUrl: string, widgetApi: WidgetApi, storage = localStorage): Promise<BridgeAPI> {
        try {
            const sessionToken = storage.getItem('hookshot-sessionToken');
            baseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
            if (sessionToken) {
                const client = new BridgeAPI(baseUrl, sessionToken);
                try {
                    await client.verify();
                    return client;
                } catch (ex) {
                    // TODO: Check that the token is actually invalid, rather than just assuming we need to refresh.
                    console.warn(`Failed to verify token, fetching new token`, ex);
                    storage.removeItem(sessionToken);
                }
            }
        } catch (ex) {
            // E.g. Browser prevents storage access.
            console.debug(`Failed to fetch session token, requesting new token`, ex);
        }

        const creds = await widgetApi.requestOpenIDConnectToken();
        const { matrix_server_name, access_token } = creds;
        // eslint-disable-next-line camelcase
        if (!matrix_server_name || !access_token) {
            throw Error('Server OpenID response missing values');
        }

        const res = await fetch(`${baseUrl}/widgetapi/v1/exchange_openid`, {
            cache: 'no-cache',
            method: 'POST',
            body: JSON.stringify({
                // eslint-disable-next-line camelcase
                matrixServer: matrix_server_name,
                // eslint-disable-next-line camelcase
                openIdToken: access_token,
            } as ExchangeOpenAPIRequestBody),
            headers: {
                'Content-Type': 'application/json',
            },
        });
        if (res.status !== 200) {
            if (res.headers.get('Content-Type')?.includes("application/json")) {
                const resultBody = await res.json();
                throw new BridgeAPIError(resultBody?.error || 'Request failed', resultBody);
            } else {
                throw new Error(`API request failed: ${await res.text()}`, );
            }
        }
        const response = await res.json() as ExchangeOpenAPIResponseBody;
        try {
            storage.setItem('hookshot-sessionToken', response.token);
        } catch (ex) {
            // E.g. Browser prevents storage access.
            console.debug(`Failed to store session token, continuing`, ex);
        }
        return new BridgeAPI(baseUrl, response.token);
    }

    private constructor(private readonly baseUrl: string, private readonly accessToken?: string) {
        this.baseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
    }

    async request(method: string, endpoint: string, body?: unknown, opts?: RequestOpts) {
        const res = await fetch(`${this.baseUrl}${endpoint}`, {
            cache: 'no-cache',
            signal: opts?.abortController?.signal,
            method,
            body: body ? JSON.stringify(body) : undefined,
            headers: {
                Authorization: `Bearer ${this.accessToken}`,
                // Only set Content-Type if we send a body
                ...(!!body && {
                    'Content-Type': 'application/json',
                }),
            },
        });
        if (res.status === 204) {
            return;
        }
        if (res.status === 200) {
            return res.json();
        }
        const resultBody = await res.json();
        throw new BridgeAPIError(resultBody?.error || 'Request failed', resultBody);
    }

    async verify(): Promise<{ userId: string, type: "widget" }> {
        return this.request('GET', `/widgetapi/v1/session`);
    }

    async state(): Promise<BridgeRoomState> {
        return this.request('GET', `/widgetapi/v1/state`);
    }

    async getEnabledConfigSections(): Promise<{[sectionName: string]: boolean}> {
        return this.request('GET', '/widgetapi/v1/config/sections');
    }

    async getServiceConfig<T>(service: string): Promise<T> {
        return this.request('GET', `/widgetapi/v1/service/${service}/config`);
    }

    async getConnectionsForRoom(roomId: string): Promise<GetConnectionsResponseItem[]> {
        return this.request('GET', `/widgetapi/v1/${encodeURIComponent(roomId)}/connections`);
    }

    async getConnectionsForService<T extends GetConnectionsResponseItem >(roomId: string, service: string): Promise<GetConnectionsForServiceResponse<T>> {
        return this.request('GET', `/widgetapi/v1/${encodeURIComponent(roomId)}/connections/${encodeURIComponent(service)}`);
    }

    async createConnection(roomId: string, type: string, config: IConnectionState): Promise<GetConnectionsResponseItem> {
        return this.request('POST', `/widgetapi/v1/${encodeURIComponent(roomId)}/connections/${encodeURIComponent(type)}`, config);
    }

    async updateConnection(roomId: string, connectionId: string, config: IConnectionState) {
        return this.request('PUT', `/widgetapi/v1/${encodeURIComponent(roomId)}/connections/${encodeURIComponent(connectionId)}`, config);
    }

    removeConnection(roomId: string, connectionId: string) {
        return this.request('DELETE', `/widgetapi/v1/${encodeURIComponent(roomId)}/connections/${encodeURIComponent(connectionId)}`);
    }

    getConnectionTargets<R>(type: string, filters?: Record<never, never>|Record<string, string>, abortController?: AbortController): Promise<R[]> {
        const searchParams = filters && !!Object.keys(filters).length && new URLSearchParams(filters);
        return this.request('GET', `/widgetapi/v1/targets/${encodeURIComponent(type)}${searchParams ? `?${searchParams}` : ''}`, undefined, { abortController });
    }

    async getAuth(service: string): Promise<GetAuthResponse> {
        return this.request('GET', `/widgetapi/v1/service/${service}/auth`);
    }

    async getAuthPoll(service: string, state: string): Promise<GetAuthPollResponse> {
        return this.request('GET', `/widgetapi/v1/service/${service}/auth/${state}`);
    }

    async serviceLogout(service: string): Promise<GetAuthResponse> {
        return this.request('POST', `/widgetapi/v1/service/${service}/auth/logout`);
    }
}

export const embedTypeParameter = 'io_element_embed_type';
export enum EmbedType {
    IntegrationManager = 'integration-manager',
    Default = 'default',
}

export type BridgeConfig = FunctionComponent<{
    roomId: string,
    showHeader: boolean,
}>;
