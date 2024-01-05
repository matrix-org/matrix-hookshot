import { BridgeConfigFigma } from "../config/Config";
import * as Figma from 'figma-js';
import { MatrixClient } from "matrix-bot-sdk";
export * from "./router";
export * from "./types";
import { Logger } from "matrix-appservice-bridge";
import { AxiosError } from "axios";

export * from "./router";
export * from "./types";

interface FigmaWebhookDefinition {
    id: string;
    endpoint: string;
    passcode: string;
    status: "ACTIVE"|"PAUSED";
    description: string;
}

const log = new Logger('FigmaWebhooks');
 
export async function ensureFigmaWebhooks(figmaConfig: BridgeConfigFigma, matrixClient: MatrixClient) {
    const publicUrl = figmaConfig.publicUrl;
    const axiosConfig = { baseURL: 'https://api.figma.com/v2'};
    
    for (const [instanceName, {accessToken, teamId, passcode}] of Object.entries(figmaConfig.instances)) {
        const accountDataKey = `figma.${teamId}.webhook_id`;
        const client = Figma.Client({
            personalAccessToken: accessToken
        });

        try {
            await client.me();
        } catch (ex) {
            const axiosErr = ex as AxiosError<{message: string}>;
            if (axiosErr.isAxiosError) {
                log.error(`Failed to check figma access token: ${axiosErr.code} ${axiosErr.response?.data?.message ?? ""}`)
            }
            throw Error(`Could not validate access token for figma team ${instanceName} (${teamId})`);
        }

        const { webhookId } = await matrixClient.getSafeAccountData<{webhookId: string|null}>(accountDataKey, {webhookId: null});
        let webhookDefinition: FigmaWebhookDefinition|undefined;
        if (webhookId) {
            try {
                webhookDefinition = (await client.client.get(`webhooks/${webhookId}`, axiosConfig)).data;
                log.info(`Found existing hook for Figma instance ${instanceName} ${webhookId}`);
            } catch (ex) {
                const axiosErr = ex as AxiosError<{message: string}>;
                if (axiosErr.response?.status !== 404) {
                    // Missing webhook, probably not found.
                    if (axiosErr.isAxiosError) {
                        log.error(`Failed to update webhook: ${axiosErr.response?.status} ${axiosErr.response?.data?.message ?? ""}`)
                    }
                    throw Error(`Failed to verify Figma webhooks for ${instanceName}: ${ex.message}`);
                }
                log.warn(`Previous webhook ID ${webhookId} stored but API returned not found, creating new one.`);
            }
        }
        if (webhookDefinition) {
            if (webhookDefinition.endpoint !== publicUrl || webhookDefinition.passcode !== passcode) {
                log.info(`Existing hook ${webhookId} for ${instanceName} has stale endpoint or passcode, updating`);
                try {
                    await client.client.put(`webhooks/${webhookId}`, {
                        passcode,
                        endpoint: publicUrl,
                    }, axiosConfig);
                } catch (ex) {
                    const axiosErr = ex as AxiosError<{message: string}>;
                    if (axiosErr.isAxiosError) {
                        log.error(`Failed to update webhook: ${axiosErr.code} ${axiosErr.response?.data?.message ?? ""}`)
                    }
                    throw Error(`Could not update an Figma webhook for instance ${instanceName}: ${ex}`);
                }
            }
        } else {
            log.info(`No webhook defined for instance ${instanceName}, creating`);
            try {
                const res = await client.client.post(`webhooks`, {
                    passcode,
                    endpoint: publicUrl,
                    description: 'matrix-hookshot',
                    event_type: 'FILE_COMMENT',
                    team_id: teamId.toString(),
                }, axiosConfig);
                webhookDefinition = res.data as FigmaWebhookDefinition;
                await matrixClient.setAccountData(accountDataKey, {webhookId: webhookDefinition.id});
            } catch (ex) {
                const axiosErr = ex as AxiosError<{message: string}>;
                if (axiosErr.isAxiosError) {
                    log.error(`Failed to create webhook: ${axiosErr.code} ${axiosErr.response?.data?.message ?? ""}`)
                }
                throw Error(`Could not create a Figma webhook for instance ${instanceName}: ${ex}`);
            }
        }
    }

}