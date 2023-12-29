import { E2ESetupTestTimeout, E2ETestEnv } from "./util/e2e-test";
import { describe, it, beforeEach, afterEach } from "@jest/globals";
import { BridgeAPI } from "../web/BridgeAPI";
import { WidgetApi } from "matrix-widget-api";

describe('Widgets', () => {
    let testEnv: E2ETestEnv;

    beforeEach(async () => {
        const webhooksPort = 9500 + E2ETestEnv.workerId;
        testEnv = await E2ETestEnv.createTestEnv({matrixLocalparts: ['user'], config: {
            widgets: {
                publicUrl: `http://localhost:${webhooksPort}`
            },
            listeners: [{
                port: webhooksPort,
                bindAddress: '0.0.0.0',
                // Bind to the SAME listener to ensure we don't have conflicts.
                resources: ['webhooks', 'widgets'],
            }],
            
        }});
        await testEnv.setUp();
    }, E2ESetupTestTimeout);

    afterEach(() => {
        return testEnv?.tearDown();
    });

    it('should be able to authenticate with the widget API', async () => {
        const user = testEnv.getUser('user');
        const bridgeApi = await BridgeAPI.getBridgeAPI(testEnv.opts.config?.widgets?.publicUrl!, {
            requestOpenIDConnectToken: () => {
                return user.getOpenIDConnectToken()
            },
        } as unknown as WidgetApi, {
            getItem() { return null},
            setItem() { },
        } as unknown as Storage);
        expect(await bridgeApi.verify()).toEqual({
            "type": "widget",
            "userId": "@user:hookshot",
        });
    });
});
