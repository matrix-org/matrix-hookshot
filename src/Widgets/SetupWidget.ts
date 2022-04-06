
import { Intent } from "matrix-bot-sdk";
import { BridgeWidgetConfig } from "../Config/Config";
import LogWrapper from "../LogWrapper";
import { HookshotWidgetKind } from "./WidgetKind";
const log = new LogWrapper("SetupWidget");

export class SetupWidget {

    static async SetupAdminRoomConfigWidget(roomId: string, botIntent: Intent, config: BridgeWidgetConfig): Promise<boolean> {
        if (await SetupWidget.createWidgetInRoom(roomId, botIntent, config, HookshotWidgetKind.RoomConfiguration, "bridge_control")) {
            await botIntent.sendText(roomId, `If your client supports it, you can open the "${config.branding.widgetTitle}" widget to configure hookshot.`);
            return true;
        }
        return false;
    }

    static async SetupRoomConfigWidget(roomId: string, botIntent: Intent, config: BridgeWidgetConfig): Promise<boolean> {
        if (await SetupWidget.createWidgetInRoom(roomId, botIntent, config, HookshotWidgetKind.RoomConfiguration, "hookshot_room_config")) {
            await botIntent.sendText(roomId, `Please open the ${config.branding.widgetTitle} widget to setup integrations.`);
            return true;
        }
        return false;
    }

    private static async createWidgetInRoom(roomId: string, botIntent: Intent, config: BridgeWidgetConfig, kind: HookshotWidgetKind, stateKey: string) {
        log.info(`Running SetupRoomConfigWidget for ${roomId}`);
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
                    "title": config.branding.widgetTitle
                },
                "id": stateKey,
                "name": config.branding.widgetTitle,
                "type": "m.custom",
                "url": `${config?.publicUrl}/#/?kind=${kind}&roomId=$matrix_room_id&widgetId=$matrix_widget_id`,
                "waitForIframeLoad": true,
            }
        );
        return false;
    }
}