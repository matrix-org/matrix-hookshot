import markdown from "markdown-it";
import { ApiError } from "./api";
import { CommandError } from "./Errors";
import { MatrixMessageContent } from "./MatrixEvent";
import { BridgePermissionLevel } from "./config/BridgePermissionLevel";
import type { PermissionCheckFn } from "./Connections";
import { RoomEvent } from "matrix-bot-sdk";
import { IJsonType } from "matrix-bot-sdk/lib/helpers/Types";
import { Category } from "./AdminRoomCommandHandler";
import { ConnectionType } from "./Connections/type";

const stringArgv = import("string-argv");
const md = new markdown();

export const botCommandSymbol = Symbol("botCommandMetadata");
export function botCommand(
  prefix: string,
  helpOrOpts: string | BotCommandOptions,
  requiredArgs: string[] = [],
  optionalArgs: string[] = [],
  includeUserId = false,
) {
  if (typeof helpOrOpts === "string") {
    return Reflect.metadata(botCommandSymbol, {
      prefix,
      help: helpOrOpts,
      requiredArgs,
      optionalArgs,
      includeUserId,
    });
  }
  return Reflect.metadata(botCommandSymbol, {
    prefix,
    ...helpOrOpts,
  });
}
export interface BotCommandOptions {
  /**
   * Help text for the command.
   */
  help: string;
  /**
   * Ordered set of arguments that are required. If too few arguments are required, this will error.
   */
  requiredArgs?: string[];
  /**
   * Optional ordered set of arguments. No checks are made, these are passed in after requiredArgs.
   */
  optionalArgs?: string[];
  /**
   * Alternative argument forms for help when syntax depends on context, such as replying to an event.
   */
  helpUsages?: BotCommandHelpUsage[];
  /**
   * Prepend the userId to the command. Always the first argument
   */
  includeUserId?: boolean;
  /**
   * Prepend the reply event to the commend. Will be the second argument
   */
  includeReply?: boolean;
  /**
   * The named category of the command, used for filtering out commands the user can't access (and help text headings)
   */
  category?: Category | ConnectionType;
  /**
   * Required permission to run this command.
   */
  permissionLevel?: BridgePermissionLevel;
  /**
   * Required permission service to run this command.
   */
  permissionService?: string;
  /**
   * Allow this command to be executed if it matches the `globalPrefix` (e.g. !github). This is usually
   * so that users can execute a command using shorthand.
   */
  runOnGlobalPrefix?: boolean;
}

type BotCommandResult = { status?: boolean; reaction?: string } | undefined;
type BotCommandFunctionWithUserId = (
  userId: string,
  ...args: string[]
) => Promise<BotCommandResult>;
type BotCommandFunctionWithReply = (
  reply?: RoomEvent<IJsonType>,
  ...args: string[]
) => Promise<BotCommandResult>;
type BotCommandFunctionWithUserIdAndReply = (
  userId: string,
  reply?: RoomEvent<IJsonType>,
  ...args: string[]
) => Promise<BotCommandResult>;
type BotCommandFunctionStandard = (
  ...args: string[]
) => Promise<BotCommandResult>;
type BotCommandFunction =
  | BotCommandFunctionStandard
  | BotCommandFunctionWithUserId
  | BotCommandFunctionWithReply
  | BotCommandFunctionWithUserIdAndReply;

export type BotCommands = {
  [prefix: string]: { fn: BotCommandFunction } & BotCommandOptions;
};
export type HelpFunction = (
  cmdPrefix?: string,
  categories?: string[],
  includeTitles?: boolean,
  globalCmdPrefix?: string,
) => MatrixMessageContent;

interface BotCommandHelpUsage {
  args: string[];
  note?: string;
  prefix?: "global";
}

export function compileBotCommands(
  ...prototypes: Record<string, BotCommandFunction>[]
): { helpMessage: HelpFunction; botCommands: BotCommands } {
  const botCommands: BotCommands = {};
  const cmdStrs: { [category: string]: string[] } = {};
  prototypes.forEach((prototype) => {
    Object.getOwnPropertyNames(prototype).forEach((propertyKey) => {
      const b = Reflect.getMetadata(botCommandSymbol, prototype, propertyKey);
      if (b) {
        const category = b.category || "default";
        cmdStrs[category] = cmdStrs[category] || [];
        const helpUsages: BotCommandHelpUsage[] = b.helpUsages || [
          {
            args: [
              ...(b.requiredArgs || []).map((arg: string) => `<${arg}>`),
              ...(b.optionalArgs || []).map((arg: string) => `[${arg}]`),
            ],
          },
        ];
        for (const usage of helpUsages) {
          const args = usage.args.length ? ` ${usage.args.join(" ")}` : "";
          const note = usage.note ? ` (${usage.note})` : "";
          const prefix =
            usage.prefix === "global" ? "££GLOBAL_PREFIX££" : "££PREFIX££";
          cmdStrs[category].push(
            ` - \`${prefix}${b.prefix}${args}\`${note} - ${b.help}`,
          );
        }
        if (botCommands[b.prefix as string]) {
          throw Error("Two commands cannot share the same prefix");
        }
        // We know that these types are safe.
        botCommands[b.prefix as string] = {
          fn: prototype[propertyKey],
          help: b.help,
          requiredArgs: b.requiredArgs,
          optionalArgs: b.optionalArgs,
          includeUserId: b.includeUserId,
          category: b.category,
          includeReply: b.includeReply,
          runOnGlobalPrefix: b.runOnGlobalPrefix,
        };
      }
    });
  });
  return {
    helpMessage: (
      cmdPrefix = "",
      onlyCategories?: string[],
      includeTitles = true,
      globalCmdPrefix = "",
    ) => {
      let content = "";
      for (const [categoryName, commands] of Object.entries(cmdStrs)) {
        if (
          categoryName !== "default" &&
          onlyCategories &&
          !onlyCategories.includes(categoryName)
        ) {
          continue;
        }
        if (includeTitles && categoryName !== "default") {
          content += `### ${categoryName[0].toUpperCase()}${categoryName.substring(1).toLowerCase()}\n`;
        }
        content += commands.join("\n") + "\n";
      }
      const body = content
        .replace(/££PREFIX££/g, cmdPrefix)
        .replace(/££GLOBAL_PREFIX££/g, globalCmdPrefix);
      return {
        msgtype: "m.notice",
        body,
        formatted_body: md.render(body),
        format: "org.matrix.custom.html",
      };
    },
    botCommands,
  };
}

interface CommandResultNotHandled {
  handled: false;
}

interface CommandResultSuccess {
  handled: true;
  result: BotCommandResult;
}

interface CommandResultErrorUnknown {
  handled: true;
  humanError?: string;
  error: Error;
}

interface CommandResultErrorHuman {
  handled: true;
  humanError: string;
  error?: Error;
}

export async function handleCommand(
  userId: string,
  command: string,
  parentEvent: RoomEvent<IJsonType> | undefined,
  botCommands: BotCommands,
  obj: unknown,
  permissionCheckFn: PermissionCheckFn,
  defaultPermissionService?: string,
  prefix?: string,
  globalPrefix?: string,
): Promise<
  | CommandResultNotHandled
  | CommandResultSuccess
  | CommandResultErrorUnknown
  | CommandResultErrorHuman
> {
  let usingGlobalPrefix = false;
  let matchedPrefix: string | undefined;
  const normalizedGlobalPrefix = globalPrefix?.trimEnd();
  const matchesGlobalPrefix =
    normalizedGlobalPrefix !== undefined &&
    command.startsWith(normalizedGlobalPrefix) &&
    (command.length === normalizedGlobalPrefix.length ||
      /\s/.test(command.charAt(normalizedGlobalPrefix.length)));
  if (prefix && command.startsWith(prefix)) {
    matchedPrefix = prefix.trimEnd();
    command = command.substring(prefix.length);
  } else if (matchesGlobalPrefix) {
    usingGlobalPrefix = true;
    matchedPrefix = normalizedGlobalPrefix;
    command = command.substring(normalizedGlobalPrefix.length);
  } else if (prefix || globalPrefix) {
    return { handled: false };
  }
  const parts = (await stringArgv).parseArgsStringToArgv(command);
  for (let i = parts.length; i > 0; i--) {
    const prefix = parts.slice(0, i).join(" ").toLowerCase();
    // We have a match!
    const command = botCommands[prefix];
    if (!command) {
      continue;
    }
    const permissionService =
      command.permissionService || defaultPermissionService;
    if (
      permissionService &&
      !permissionCheckFn(
        permissionService,
        command.permissionLevel || BridgePermissionLevel.commands,
      )
    ) {
      return {
        handled: true,
        humanError: "You do not have permission to use this command.",
      };
    }
    if (!command.includeReply && parentEvent) {
      // Ignore replies if we aren't expecting one.
      return {
        handled: false,
      };
    }
    if (!command.runOnGlobalPrefix && usingGlobalPrefix) {
      // Ignore global prefix commands.
      return {
        handled: false,
      };
    }

    if (
      command.requiredArgs &&
      command.requiredArgs.length > parts.length - i
    ) {
      return {
        handled: true,
        humanError: "Missing at least one required parameter.",
      };
    }
    const args: string[] = parts.slice(i);
    try {
      let result: BotCommandResult;
      if (command.includeUserId && command.includeReply) {
        result = await (
          botCommands[prefix].fn as BotCommandFunctionWithUserIdAndReply
        ).apply(obj, [userId, parentEvent, ...args]);
      } else if (command.includeUserId) {
        result = await (
          botCommands[prefix].fn as BotCommandFunctionWithUserId
        ).apply(obj, [userId, ...args]);
      } else if (command.includeReply) {
        result = await (
          botCommands[prefix].fn as BotCommandFunctionWithReply
        ).apply(obj, [parentEvent, ...args]);
      } else {
        result = await (
          botCommands[prefix].fn as BotCommandFunctionStandard
        ).apply(obj, args);
      }
      return { handled: true, result };
    } catch (ex) {
      const commandError = ex as CommandError;
      if (ex instanceof ApiError) {
        return { handled: true, humanError: ex.error };
      }
      return {
        handled: true,
        error: commandError,
        humanError: commandError.humanError,
      };
    }
  }
  if (matchedPrefix) {
    return {
      handled: true,
      humanError: `Unknown command. Try "${matchedPrefix} help" for available commands.`,
    };
  }
  return { handled: false };
}
