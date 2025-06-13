import markdown from "markdown-it";
import { ApiError } from "./api";
import { CommandError } from "./Errors";
import { MatrixEvent, MatrixMessageContent } from "./MatrixEvent";
import { BridgePermissionLevel } from "./config/Config";
import { PermissionCheckFn } from "./Connections";

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
  category?: string;
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
  reply?: MatrixEvent<unknown>,
  ...args: string[]
) => Promise<BotCommandResult>;
type BotCommandFunctionWithUserIdAndReply = (
  userId: string,
  reply?: MatrixEvent<unknown>,
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
) => MatrixMessageContent;

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
        const requiredArgs =
          b.requiredArgs?.map((arg: string) => `<${arg}>`).join(" ") || "";
        const optionalArgs =
          b.optionalArgs?.map((arg: string) => `[${arg}]`).join(" ") || "";
        const cmdStr =
          ` - \`££PREFIX££${b.prefix}` +
          (requiredArgs ? ` ${requiredArgs}` : "") +
          (optionalArgs ? ` ${optionalArgs}` : "") +
          `\` - ${b.help}`;
        cmdStrs[category] = cmdStrs[category] || [];
        cmdStrs[category].push(cmdStr);
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
      return {
        msgtype: "m.notice",
        body: content.replace(/££PREFIX££/g, cmdPrefix),
        formatted_body: md.render(content).replace(/££PREFIX££/g, cmdPrefix),
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
  parentEvent: MatrixEvent<unknown> | undefined,
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
  if (prefix && command.startsWith(prefix)) {
    command = command.substring(prefix.length);
  } else if (globalPrefix && command.startsWith(globalPrefix)) {
    usingGlobalPrefix = true;
    command = command.substring(globalPrefix.length);
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
  return { handled: false };
}
