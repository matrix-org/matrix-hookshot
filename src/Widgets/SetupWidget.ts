
import { Intent } from "matrix-bot-sdk";
import { BridgeWidgetConfig } from "../Config/Config";
import LogWrapper from "../LogWrapper";
import { HookshotWidgetKind } from "./WidgetKind";
const log = new LogWrapper("SetupWidget");

export class SetupWidget {
    static async SetupRoomConfigWidget(roomId: string, botIntent: Intent, config: BridgeWidgetConfig): Promise<boolean> {
        const widgetKey = "hookshot_room_config";
        log.info(`Running setupWidget for ${roomId}`);
        try {
            const res = await botIntent.underlyingClient.getRoomStateEvent(
                roomId,
                "im.vector.modular.widgets",
                "hookshot_room_config"
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
            widgetKey,
            {
                "creatorUserId": botIntent.userId,
                "data": {
                    "title": "Hookshot Configuration"
                },
                "id": widgetKey,
                "name": "Hookshot Configuration",
                "type": "m.custom",
                "url": `${config?.publicUrl}/#/?kind=${HookshotWidgetKind.RoomConfiguration}&roomId=$matrix_room_id&widgetId=$matrix_widget_id`,
                "waitForIframeLoad": true,
            }
        );
        await botIntent.sendText(roomId, `Please open the "Hookshot Configuration" widget to setup integrations.`);
        return true;
    }
}