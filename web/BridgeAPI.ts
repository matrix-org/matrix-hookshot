import { BridgeRoomState, WidgetConfigurationOptions, WidgetConfigurationType } from '../src/Widgets/BridgeWidgetInterface';

export class BridgeAPIError extends Error {
    constructor(msg: string, private body: Record<string, unknown>) {
        super(msg);
    }
}

export default class BridgeAPI {

    constructor(private readonly baseUrl: string, private readonly accessToken: string) {}

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

    async verify() {
        return this.request('GET', `/widgetapi/v1/verify`);
    }

    async state(): Promise<BridgeRoomState> {
        return this.request('GET', `/widgetapi/v1/state`);
    }

    async getEnabledConfigSections(): Promise<{[sectionName: string]: boolean}> {
        return this.request('GET', '/widgetapi/v1/config/sections');
    }

    async getConfig(section: string): Promise<WidgetConfigurationOptions> {
        return this.request('GET', `/widgetapi/v1/config/${section}`);
    }
}