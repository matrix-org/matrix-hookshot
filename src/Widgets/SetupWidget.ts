
import { Intent } from "matrix-bot-sdk";
import { BridgeWidgetConfig } from "../Config/Config";
import LogWrapper from "../LogWrapper";
import { HookshotWidgetKind } from "./WidgetKind";
const log = new LogWrapper("SetupWidget");

export class SetupWidget {
    static async SetupRoomConfigWidget(roomId: string, botIntent: Intent, config: BridgeWidgetConfig) {
        const widgetKey = "hookshot_room_config";
        log.info(`Running setupWidget for ${roomId}`);
        try {
            const res = await botIntent.underlyingClient.getRoomStateEvent(
                roomId,
                "im.vector.modular.widgets",
                "hookshot_room_config"
            );
            if (res) {
                log.debug(`Widget for ${roomId} exists, not creating`);
                // No-op
                // Validate?
                return;
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
                    "title": "Hookshot Room Configuration"
                },
                "id": widgetKey,
                "name": "Hookshot Room Configuration",
                "type": "m.custom",
                "url": `${config?.publicUrl}/#/?kind=${HookshotWidgetKind.RoomConfiguration}&roomId=$matrix_room_id&widgetId=$matrix_widget_id`,
                "waitForIframeLoad": true,
            }
        );
        await botIntent.sendText(roomId, `Please open the "Hookshot Room Configuration" widget to configure the room with integrations.`);
    }
}