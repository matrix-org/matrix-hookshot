import {
  botCommand,
  BotCommands,
  handleCommand,
  HelpFunction,
} from "../BotCommands";
import { Logger } from "matrix-appservice-bridge";
import {
  IRichReplyMetadata,
  MatrixClient,
  MessageEvent,
  RoomEvent,
} from "matrix-bot-sdk";
import { MatrixMessageContent, MatrixEvent } from "../MatrixEvent";
import { BaseConnection } from "./BaseConnection";
import { IConnectionState, PermissionCheckFn } from ".";
import { IJsonType } from "matrix-bot-sdk/lib/helpers/Types";
import { BridgeConfigMessaging } from "../config/sections";
import markdownit from "markdown-it";
const md = markdownit();
const log = new Logger("CommandConnection");

/**
 * Connection class that handles commands for a given connection. Should be used
 * by connections expecting to handle user input.
 */
export abstract class CommandConnection<
  StateType extends IConnectionState = IConnectionState,
  ValidatedStateType extends StateType = StateType,
> extends BaseConnection {
  protected includeTitlesInHelp?: boolean;
  constructor(
    roomId: string,
    stateKey: string,
    canonicalStateType: string,
    protected state: ValidatedStateType,
    private readonly botClient: MatrixClient,
    protected readonly msgConfig: BridgeConfigMessaging,
    private readonly botCommands: BotCommands,
    private readonly helpMessage: HelpFunction,
    protected readonly helpCategories: string[],
    protected readonly defaultCommandPrefix: string,
    protected readonly serviceName?: string,
  ) {
    super(roomId, stateKey, canonicalStateType);
  }

  protected get commandPrefix() {
    return (this.state.commandPrefix || this.defaultCommandPrefix) + " ";
  }

  public conflictsWithCommandPrefix(commandPrefix: string) {
    return this.commandPrefix === commandPrefix + " ";
  }

  public async onStateUpdate(stateEv: MatrixEvent<unknown>) {
    this.state = await this.validateConnectionState(stateEv.content);
  }

  protected abstract validateConnectionState(
    content: unknown,
  ): Promise<ValidatedStateType> | ValidatedStateType;

  public async onMessageEvent(
    ev: MatrixEvent<MatrixMessageContent>,
    checkPermission: PermissionCheckFn,
    parentEvent?: RoomEvent<IJsonType>,
  ) {
    const commandResult = await handleCommand(
      ev.sender,
      ev.content.body,
      parentEvent,
      this.botCommands,
      this,
      checkPermission,
      this.serviceName,
      this.commandPrefix,
      this.defaultCommandPrefix,
    );
    if (commandResult.handled !== true) {
      // Not for us.
      return false;
    }
    if ("error" in commandResult || "humanError" in commandResult) {
      const { humanError, error } = commandResult;
      await this.botClient.sendEvent(this.roomId, "m.reaction", {
        "m.relates_to": {
          rel_type: "m.annotation",
          event_id: ev.event_id,
          key: "⛔",
        },
      });
      await this.botClient.sendEvent(this.roomId, "m.room.message", {
        msgtype: "m.notice",
        body: humanError
          ? `Failed to handle command: ${humanError}`
          : "Failed to handle command.",
      });
      log.warn(`Failed to handle command:`, error ?? "Unknown error");
      return true;
    } else {
      const reaction = commandResult.result?.reaction || "✅";
      await this.botClient.sendEvent(this.roomId, "m.reaction", {
        "m.relates_to": {
          rel_type: "m.annotation",
          event_id: ev.event_id,
          key: reaction,
        },
      });
      return true;
    }
  }

  @botCommand("help", "This help text")
  public async helpCommand() {
    return this.botClient.sendEvent(
      this.roomId,
      "m.room.message",
      this.helpMessage(
        this.commandPrefix,
        this.helpCategories,
        this.includeTitlesInHelp,
      ),
    );
  }

  protected sendEvent(
    body: string,
    extraContent: any = {},
    opts = { inline: true },
  ) {
    const content = this.msgConfig.formatMatrixMessage(
      {
        msgtype: "m.notice",
        body,
        formatted_body: opts.inline ? md.renderInline(body) : md.render(body),
        format: "org.matrix.custom.html",
        ...extraContent,
      },
      {
        allowUrlPreviews: this.state.showUrlPreviews,
      },
    );
    return this.botClient.sendMessage(this.roomId, content);
  }
}
