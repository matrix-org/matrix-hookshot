import { MessageSenderClient } from "./MatrixSender";
import { IStorageProvider } from "./Stores/StorageProvider";
import { UserNotificationsEvent, UserNotification } from "./UserNotificationWatcher";
import { LogWrapper } from "./LogWrapper";
import { AdminRoom } from "./AdminRoom";
import { FormatUtil } from "./FormatUtil";

const log = new LogWrapper("GithubBridge");

export class NotificationProcessor {
    constructor(private storage: IStorageProvider, private matrixSender: MessageSenderClient) {

    }

    public async onUserEvents(msg: UserNotificationsEvent, adminRoom: AdminRoom) {
        log.info(`Got new events for ${adminRoom.userId}`);
        for (const event of msg.events) {
            try {
                await this.handleUserNotification(msg.roomId, event);
            } catch (ex) {
                log.warn("Failed to handle event:", ex);
            }
        }
        try {
            await adminRoom.setNotifSince(msg.lastReadTs);
        } catch (ex) {
            log.error("Failed to update stream position for notifications:", ex);
        }
    }

    private async handleUserNotification(roomId: string, notif: UserNotification) {
        log.info("New notification event:", notif);
        const formatted = FormatUtil.formatNotification(notif);
        await this.matrixSender.sendMatrixMessage(roomId, {
            msgtype: "m.text",
            body: formatted.plain,
            formatted_body: formatted.html,
            format: "org.matrix.custom.html",
        });
    }
}