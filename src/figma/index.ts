import { BridgeConfigFigma } from "../Config/Config";
import * as Figma from 'figma-js';
import { MatrixClient } from "matrix-bot-sdk";
import { AxiosError } from "axios";
import LogWrapper from "../LogWrapper";

export * from "./router";
export * from "./types";

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
        const accountDataKey = `figma.${teamId}.webhook_id`;
        const client = Figma.Client({
            personalAccessToken: accessToken
        });

        try {
            await client.me();
        } catch (ex) {
            const axiosErr = ex as AxiosError;
            if (axiosErr.isAxiosError) {
                log.error(`Failed to check figma access token: ${axiosErr.code} ${axiosErr.response?.data?.message ?? ""}`)
            }
            throw Error(`Could not validate access token for figma team ${instanceName} (${teamId})`);
        }

        const { webhookId } = await matrixClient.getSafeAccountData<{webhookId: string|null}>(accountDataKey, {webhookId: null});
        let webhookDefinition: FigmaWebhookDefinition|undefined;
        if (webhookId) {
            try {
                webhookDefinition = (await client.client.get(`v2/webhooks/${webhookId}`, axiosConfig)).data;
                log.info(`Found existing hook for Figma instance ${instanceName} ${webhookId}`);
            } catch (ex) {
                const axiosErr = ex as AxiosError;
                if (axiosErr.isAxiosError) {
                    log.error(`Failed to update webhook: ${axiosErr.code} ${axiosErr.response?.data?.message ?? ""}`)
                }
                throw Error(`Failed to verify Figma webhooks for ${instanceName}: ${ex.message}`);
            }
        }
        if (webhookDefinition) {
            if (webhookDefinition.endpoint !== publicUrl || webhookDefinition.passcode !== passcode) {
                log.info(`Existing hook ${webhookId} for ${instanceName} has stale endpoint or passcode, updating`);
                try {
                    await client.client.put(`v2/webhooks/${webhookId}`, {
                        passcode,
                        endpoint: publicUrl,
                    }, axiosConfig);
                } catch (ex) {
                    const axiosErr = ex as AxiosError;
                    if (axiosErr.isAxiosError) {
                        log.error(`Failed to update webhook: ${axiosErr.code} ${axiosErr.response?.data?.message ?? ""}`)
                    }
                    throw Error(`Could not update an Figma webhook for instance ${instanceName}: ${ex}`);
                }
            }
        } else {
            log.info(`No webhook defined for instance ${instanceName}, creating`);
            try {
                const res = await client.client.post(`v2/webhooks`, {
                    passcode,
                    endpoint: publicUrl,
                    description: 'matrix-hookshot',
                    event_type: 'FILE_COMMENT',
                    team_id: teamId,
                }, axiosConfig);
                webhookDefinition = res.data as FigmaWebhookDefinition;
                await matrixClient.setAccountData(accountDataKey, {webhookId: webhookDefinition.id});
            } catch (ex) {
                const axiosErr = ex as AxiosError;
                if (axiosErr.isAxiosError) {
                    log.error(`Failed to create webhook: ${axiosErr.code} ${axiosErr.response?.data?.message ?? ""}`)
                }
                throw Error(`Could not create a Figma webhook for instance ${instanceName}: ${ex}`);
            }
        }
    }

}