import markdown from "markdown-it";
import stringArgv from "string-argv";
import { ApiError } from "./api";
import { CommandError } from "./errors";
import { MatrixMessageContent } from "./MatrixEvent";
import { BridgePermissionLevel } from "./Config/Config";
import { PermissionCheckFn } from "./Connections";

const md = new markdown();

export const botCommandSymbol = Symbol("botCommandMetadata");
export function botCommand(prefix: string, helpOrOpts: string|BotCommandOptions, requiredArgs: string[] = [], optionalArgs: string[] = [], includeUserId = false) {
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
        ...helpOrOpts
    });
}
export interface BotCommandOptions {
    help: string,
    requiredArgs?: string[],
    optionalArgs?: string[],
    includeUserId?: boolean,
    category?: string,
    permissionLevel?: BridgePermissionLevel,
    permissionService?: string,
}


type BotCommandResult = {status?: boolean, reaction?: string}|undefined;
type BotCommandFunction = (...args: string[]) => Promise<BotCommandResult>;

export type BotCommands = {[prefix: string]: {fn: BotCommandFunction} & BotCommandOptions};
export type HelpFunction = (cmdPrefix?: string, categories?: string[], includeTitles?: boolean) => MatrixMessageContent

export function compileBotCommands(...prototypes: Record<string, BotCommandFunction>[]): {helpMessage: HelpFunction, botCommands: BotCommands} {
    const botCommands: BotCommands = {};
    const cmdStrs: {[category: string]: string[]} = {};
    prototypes.forEach(prototype => {
        Object.getOwnPropertyNames(prototype).forEach(propetyKey => {
            const b = Reflect.getMetadata(botCommandSymbol, prototype, propetyKey);
            if (b) {
                const category = b.category || "default";
                const requiredArgs = b.requiredArgs?.join(" ") || "";
                const optionalArgs = b.optionalArgs?.map((arg: string) =>  `[${arg}]`).join(" ") || "";
                cmdStrs[category] = cmdStrs[category] || []
                cmdStrs[category].push(` - \`££PREFIX££${b.prefix}\` ${requiredArgs} ${optionalArgs} - ${b.help}`);
                // We know that these types are safe.
                botCommands[b.prefix as string] = {
                    fn: prototype[propetyKey],
                    help: b.help,
                    requiredArgs: b.requiredArgs,
                    optionalArgs: b.optionalArgs,
                    includeUserId: b.includeUserId,
                    category: b.category,
                };
            }
        });
    })
    return {
        helpMessage: (cmdPrefix?: string, onlyCategories?: string[], includeTitles=true) => {
            let content = "";
            for (const [categoryName, commands] of Object.entries(cmdStrs)) {
                if (categoryName !== "default" && onlyCategories && !onlyCategories.includes(categoryName)) {
                    continue;
                }
                if (includeTitles && categoryName !== "default") {
                    content += `### ${categoryName[0].toUpperCase()}${categoryName.substring(1).toLowerCase()}\n`;
                }
                content += commands.join('\n') + "\n";
            }
            return {
                msgtype: "m.notice",
                body: content.replace(/££PREFIX££/g, cmdPrefix || ""),
                formatted_body: md.render(content).replace(/££PREFIX££/g, cmdPrefix || ""),
                format: "org.matrix.custom.html"
            }
        },
        botCommands,
    }
}

export async function handleCommand(
    userId: string, command: string, botCommands: BotCommands, obj: unknown, permissionCheckFn: PermissionCheckFn,
    defaultPermissionService?: string, prefix?: string)
: Promise<{handled: false}|{handled: true, result: BotCommandResult}|{handled: true, error: string, humanError?: string}> {
    if (prefix) {
        if (!command.startsWith(prefix)) {
            return {handled: false};
        }
        command = command.substring(prefix.length);
    }
    const parts = stringArgv(command);
    for (let i = parts.length; i > 0; i--) {
        const prefix = parts.slice(0, i).join(" ").toLowerCase();
        // We have a match!
        const command = botCommands[prefix];
        if (command) {
            const permissionService = command.permissionService || defaultPermissionService;
            if (permissionService && !permissionCheckFn(permissionService, command.permissionLevel || BridgePermissionLevel.commands)) {
                return {handled: true, error: "You do not have permission to use this command."};
            }
            if (command.requiredArgs && command.requiredArgs.length > parts.length - i) {
                return {handled: true, error: "Missing at least one required parameter."};
            }
            const args = parts.slice(i);
            if (command.includeUserId) {
                args.splice(0,0, userId);
            }
            try {
                const result = await botCommands[prefix].fn.apply(obj,  args);
                return {handled: true, result};
            } catch (ex) {
                const commandError = ex as CommandError;
                if (ex instanceof ApiError) {
                    return {handled: true, error: ex.error, humanError: ex.error};
                }
                return {handled: true, error: commandError.message, humanError: commandError.humanError};
            }
        }
    }
    return {handled: false};
}