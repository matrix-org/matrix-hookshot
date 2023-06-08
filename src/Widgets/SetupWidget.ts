
import { Intent } from "matrix-bot-sdk";
import { BridgeWidgetConfig } from "../config/Config";
import { Logger } from "matrix-appservice-bridge";
import { CommandError } from "../errors";
import { HookshotWidgetKind } from "./WidgetKind";
const log = new Logger("SetupWidget");

export class SetupWidget {

    static async SetupAdminRoomConfigWidget(roomId: string, botIntent: Intent, config: BridgeWidgetConfig): Promise<boolean> {
        if (await SetupWidget.createWidgetInRoom(roomId, botIntent, config, HookshotWidgetKind.Settings, "bridge_control")) {
            await botIntent.sendText(roomId, `If your client supports it, you can open the "${config.branding.widgetTitle}" widget to configure hookshot.`);
            return true;
        }
        return false;
    }

    static async SetupRoomConfigWidget(roomId: string, botIntent: Intent, config: BridgeWidgetConfig, serviceTypes: string[]): Promise<boolean> {
        // If this is for a single service, scope the widget
        const serviceScope = serviceTypes.length === 1 ? serviceTypes[0] : undefined;
        if (await SetupWidget.createWidgetInRoom(
            roomId,
            botIntent,
            config,
            HookshotWidgetKind.RoomConfiguration,
            `hookshot_room_config_${config.parsedPublicUrl.host}${serviceScope ? '_' + serviceScope : ''}`,
            serviceScope,
        )) {
            await botIntent.sendText(roomId, `Please open the ${config.branding.widgetTitle} widget to set up integrations.`);
            return true;
        }
        return false;
    }

    private static async createWidgetInRoom(
        roomId: string,
        botIntent: Intent,
        config: BridgeWidgetConfig,
        kind: HookshotWidgetKind,
        stateKey: string,
        serviceScope?: string,
    ): Promise<boolean> {
        log.info(`Running SetupRoomConfigWidget for ${roomId}`);
        if (!await botIntent.underlyingClient.userHasPowerLevelFor(botIntent.userId, roomId, "im.vector.modular.widgets", true)) {
            throw new CommandError("Bot lacks power level to set room state", "I do not have permission to create a widget in this room. Please promote me to an Admin/Moderator.");
        }
        try {
            const res = await botIntent.underlyingClient.getRoomStateEvent(
                roomId,
                "im.vector.modular.widgets",
                stateKey
            );
            // Deleted widgets are empty objects
            if (res && Object.keys(res).length > 0) {
                log.debug(`Widget for ${roomId} exists, not creating`);
                // No-op
                // Validate?
                return false;
            }
        } catch (ex) {
            // Didn't exist, create it.
        }
        log.debug(`Generating widget state event for ${roomId}`);
        await botIntent.underlyingClient.sendStateEvent(
            roomId,
            "im.vector.modular.widgets",
            stateKey,
            {
                "creatorUserId": botIntent.userId,
                "data": {
                    "title": serviceScope ? serviceScope : config.branding.widgetTitle,
                },
                "id": stateKey,
                "name": config.branding.widgetTitle,
                "type": "m.custom",
                "url": new URL(`#/?kind=${kind}&roomId=$matrix_room_id&widgetId=$matrix_widget_id${serviceScope ? `&serviceScope=${serviceScope}` : ''}`, config.parsedPublicUrl).href,
                "waitForIframeLoad": true,
            }
        );
        return true;
    }
}
