import { BridgeConfigFigma } from "../Config/Config";
import * as Figma from 'figma-js';
import { MatrixClient } from "matrix-bot-sdk";
export * from "./router";
export * from "./types";
import LogWrapper from "../LogWrapper";


interface FigmaWebhookDefinition {
    id: string;
    endpoint: string;
    passcode: string;
    status: "ACTIVE"|"PAUSED";
    description: string;
}

const log = new LogWrapper('FigmaWebhooks');
 
export async function ensureFigmaWebhooks(figmaConfig: BridgeConfigFigma, matrixClient: MatrixClient) {
    const publicUrl = figmaConfig.publicUrl;
    const axiosConfig = { baseURL: 'https://api.figma.com/v2'};
    
    for (const [instanceName, {accessToken, teamId, passcode}] of Object.entries(figmaConfig.instances)) {
        const client = Figma.Client({
            personalAccessToken: accessToken
        });
        const accountDataKey = `figma.${teamId}.webhook_id`;
        const { webhookId } = await matrixClient.getSafeAccountData<{webhookId: string|null}>(accountDataKey, {webhookId: null});
        let webhookDefinition: FigmaWebhookDefinition|undefined;
        if (webhookId) {
            try {
                webhookDefinition = (await client.client.get(`webhooks/${webhookId}`, axiosConfig)).data;
                log.info(`Found existing hook for Figma instance ${instanceName} ${webhookId}`);
            } catch (ex) {
                throw Error(`Failed to verify Figma webhooks for ${instanceName}: ${ex.message}`);
            }
        }
        if (webhookDefinition) {
            if (webhookDefinition.endpoint !== publicUrl || webhookDefinition.passcode !== passcode) {
                log.info(`Existing hook ${webhookId} for ${instanceName} has stale endpoint or passcode, updating`);
                await client.client.put(`webhooks/${webhookId}`, {
                    passcode,
                    endpoint: publicUrl,
                }, axiosConfig);
            }
        } else {
            log.info(`No webhook defined for instance ${instanceName}, creating`);
            const res = await client.client.post(`webhooks`, {
                passcode,
                endpoint: publicUrl,
                description: 'matrix-hookshot',
                event_type: 'FILE_COMMENT',
                team_id: teamId
            }, axiosConfig);
            webhookDefinition = res.data as FigmaWebhookDefinition;
            await matrixClient.setAccountData(accountDataKey, {webhookId: webhookDefinition.id});
        }
        // Webhook is ready and set up
    }

}