import { BridgeRoomState, GetConnectionsForServiceResponse, WidgetConfigurationSection } from '../src/Widgets/BridgeWidgetInterface';
import { GetConnectionsResponseItem } from "../src/provisioning/api";
import { ExchangeOpenAPIRequestBody, ExchangeOpenAPIResponseBody } from "matrix-appservice-bridge";
import { WidgetApi } from 'matrix-widget-api';
export class BridgeAPIError extends Error {
    constructor(msg: string, private body: Record<string, unknown>) {
        super(msg);
    }
}

export default class BridgeAPI {
    static async getBridgeAPI(baseUrl: string, widgetApi: WidgetApi): Promise<BridgeAPI> {
        const sessionToken = localStorage.getItem('hookshot-sessionToken');
        baseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
        if (sessionToken) {
            const client = new BridgeAPI(baseUrl, sessionToken);
            try {
                await client.verify();
                return client;
            } catch (ex) {
                // Clear the token from the server, also actually check the error here.
                console.warn(`Failed to verify token, fetching new token`, ex);
                localStorage.removeItem(sessionToken);
            }
        }
        const creds = await widgetApi.requestOpenIDConnectToken();
        const { matrix_server_name, access_token } = creds;
        // eslint-disable-next-line camelcase
        if (!matrix_server_name || !access_token) {
            throw Error('Server OpenID response missing values');
        }

        const req = await fetch(`${baseUrl}/widgetapi/v1/exchange_openid`, {
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
        if (req.status !== 200) {
            throw Error(`Response was not 200: ${await req.text()}`);
        }
        const response = await req.json() as ExchangeOpenAPIResponseBody;
        localStorage.setItem('hookshot-sessionToken', response.token);
        return new BridgeAPI(baseUrl, response.token);
    }

    private constructor(private readonly baseUrl: string, private readonly accessToken?: string) {
        this.baseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
    }

    async request(method: string, endpoint: string, body?: unknown) {
        const req = await fetch(`${this.baseUrl}${endpoint}`, {
            cache: 'no-cache',
            method,
            body: body ? JSON.stringify(body) : undefined,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.accessToken}`,
            },
        });
        if (req.status === 204) {
            return;
        }
        if (req.status === 200) {
            return req.json();
        }
        const resultBody = await req.json();
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

    async getConfig(section: string): Promise<WidgetConfigurationSection[]> {
        return this.request('GET', `/widgetapi/v1/config/${section}`);
    }

    async getServiceConfig(service: string): Promise<Record<string, unknown>> {
        return this.request('GET', `/widgetapi/v1/service/${service}/config`);
    }
    
    async getConnectionsForRoom(roomId: string): Promise<GetConnectionsResponseItem[]> {
        return this.request('GET', `/widgetapi/v1/${encodeURIComponent(roomId)}/connections`);
    }

    async getConnectionsForService<T extends GetConnectionsResponseItem >(roomId: string, service: string): Promise<GetConnectionsForServiceResponse<T>> {
        return this.request('GET', `/widgetapi/v1/${encodeURIComponent(roomId)}/connections/${encodeURIComponent(service)}`);
    }

    async createConnection(roomId: string, type: string, config: unknown) {
        return this.request('POST', `/widgetapi/v1/${encodeURIComponent(roomId)}/connections/${encodeURIComponent(type)}`, config);
    }

    async updateConnection(roomId: string, connectionId: string, config: unknown) {
        return this.request('PUT', `/widgetapi/v1/${encodeURIComponent(roomId)}/connections/${encodeURIComponent(connectionId)}`, config);
    }

    removeConnection(roomId: string, connectionId: string) {
        return this.request('DELETE', `/widgetapi/v1/${encodeURIComponent(roomId)}/connections/${encodeURIComponent(connectionId)}`);
    }
}