import { botCommand, BotCommands, handleCommand, HelpFunction } from "../BotCommands";
import LogWrapper from "../LogWrapper";
import { MatrixClient } from "matrix-bot-sdk";
import { MatrixMessageContent, MatrixEvent } from "../MatrixEvent";
import { BaseConnection } from "./BaseConnection";
import { PermissionCheckFn } from ".";
const log = new LogWrapper("CommandConnection");

/**
 * Connection class that handles commands for a given connection. Should be used
 * by connections expecting to handle user input.
 */
export abstract class CommandConnection extends BaseConnection {
    protected enabledHelpCategories?: string[];
    protected includeTitlesInHelp?: boolean;
    constructor(
        roomId: string,
        stateKey: string,
        canonicalStateType: string,
        private readonly botClient: MatrixClient,
        private readonly botCommands: BotCommands,
        private readonly helpMessage: HelpFunction,
        protected readonly stateCommandPrefix: string,
        protected readonly serviceName?: string,
    ) {
        super(roomId, stateKey, canonicalStateType);
    }  

    protected get commandPrefix() {
        return this.stateCommandPrefix + " ";
    }

    public async onMessageEvent(ev: MatrixEvent<MatrixMessageContent>, checkPermission: PermissionCheckFn) {
        const commandResult = await handleCommand(
            ev.sender, ev.content.body, this.botCommands, this,checkPermission,
            this.serviceName, this.commandPrefix
        );
        if (commandResult.handled !== true) {
            // Not for us.
            return false;
        }
        if ("error" in commandResult) {
            const { humanError, error} = commandResult;
            await this.botClient.sendEvent(this.roomId, "m.reaction", {
                "m.relates_to": {
                    rel_type: "m.annotation",
                    event_id: ev.event_id,
                    key: "⛔",
                }
            });
            await this.botClient.sendEvent(this.roomId, 'm.room.message', {
                msgtype: "m.notice",
                body: humanError ? `Failed to handle command: ${humanError}` : "Failed to handle command.",
            });
            log.warn(`Failed to handle command:`, error);
            return true;
        } else {
            const reaction = commandResult.result?.reaction || '✅';
            await this.botClient.sendEvent(this.roomId, "m.reaction", {
                "m.relates_to": {
                    rel_type: "m.annotation",
                    event_id: ev.event_id,
                    key: reaction,
                }
            });
            return true;
        }
    }

    @botCommand("help", "This help text")
    public async helpCommand() {
        return this.botClient.sendEvent(this.roomId, 'm.room.message', this.helpMessage(this.commandPrefix, this.enabledHelpCategories, this.includeTitlesInHelp));
    }
}