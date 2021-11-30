import { botCommand, BotCommands, handleCommand } from "../BotCommands";
import LogWrapper from "../LogWrapper";
import { MatrixClient } from "matrix-bot-sdk";
import { MatrixMessageContent, MatrixEvent } from "../MatrixEvent";
const log = new LogWrapper("CommandConnection");

export abstract class CommandConnection {
    constructor(
        public readonly roomId: string,
        private readonly botClient: MatrixClient,
        private readonly botCommands: BotCommands,
        private readonly helpMessage: (prefix: string) => MatrixMessageContent,
        protected readonly stateCommandPrefix: string,
    ) { }  

    protected get commandPrefix() {
        return this.stateCommandPrefix + " ";
    }

    public async onMessageEvent(ev: MatrixEvent<MatrixMessageContent>) {
        const { error, handled, humanError } = await handleCommand(ev.sender, ev.content.body, this.botCommands, this, this.commandPrefix);
        if (!handled) {
            // Not for us.
            return false;
        }
        if (error) {
            await this.botClient.sendEvent(this.roomId, "m.reaction", {
                "m.relates_to": {
                    rel_type: "m.annotation",
                    event_id: ev.event_id,
                    key: "⛔",
                }
            });
            await this.botClient.sendEvent(this.roomId, 'm.room.message', {
                msgtype: "m.notice",
                body: humanError ? `Failed to handle command: ${humanError}` : "Failed to handle command",
            });
            log.warn(`Failed to handle command:`, error);
            return true;
        }
        await this.botClient.sendEvent(this.roomId, "m.reaction", {
            "m.relates_to": {
                rel_type: "m.annotation",
                event_id: ev.event_id,
                key: "✅",
            }
        });
        return true;
    }

    @botCommand("help", "This help text")
    public async helpCommand() {
        return this.botClient.sendEvent(this.roomId, 'm.room.message', this.helpMessage(this.commandPrefix));
    }
}