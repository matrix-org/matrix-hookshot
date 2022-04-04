import { BridgeRoomState } from '../src/Widgets/BridgeWidgetInterface';

export class BridgeAPIError extends Error {
    constructor(msg: string, private body: Record<string, unknown>) {
        super(msg);
    }
}

export default class BridgeAPI {

    constructor(private baseUrl: string, private roomId: string, private accessToken: string) {
    }

    async request(method: string, endpoint: string, body?: unknown) {
        const req = await fetch(`${this.baseUrl}${endpoint}`, {
            cache: 'no-cache',
            method,
            body: body ? JSON.stringify(body) : undefined,
            headers: {
                'Authorization': `Bearer ${this.accessToken}`,
                // Only set Content-Type if we send a body
                ...(!!body && {
                    'Content-Type': 'application/json',
                }),
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
        return this.request('GET', `/widgetapi/${encodeURIComponent(this.roomId)}/verify`);
    }

    async state(): Promise<BridgeRoomState> {
        return this.request('GET', `/widgetapi/${encodeURIComponent(this.roomId)}`);
    }
}