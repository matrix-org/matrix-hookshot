import markdown from "markdown-it";
import stringArgv from "string-argv";
import { MatrixMessageContent } from "./MatrixEvent";

const md = new markdown();

export const botCommandSymbol = Symbol("botCommandMetadata");
export function botCommand(prefix: string, help: string, requiredArgs: string[] = [], optionalArgs: string[] = [], includeUserId = false) {
    return Reflect.metadata(botCommandSymbol, {
        prefix,
        help,
        requiredArgs,
        optionalArgs,
        includeUserId,
    });
}

type BotCommandFunction = (...args: string[]) => Promise<{status: boolean}>;

export type BotCommands = {[prefix: string]: {
    fn: BotCommandFunction,
    requiredArgs: string[],
    optionalArgs: string[],
    includeUserId: boolean,
}};

export function compileBotCommands(prototype: Record<string, BotCommandFunction>): {helpMessage: (cmdPrefix?: string) => MatrixMessageContent, botCommands: BotCommands} {
    let content = "Commands:\n";
    const botCommands: BotCommands = {};
    Object.getOwnPropertyNames(prototype).forEach(propetyKey => {
        const b = Reflect.getMetadata(botCommandSymbol, prototype, propetyKey);
        if (b) {
            const requiredArgs = b.requiredArgs.join(" ");
            const optionalArgs = b.optionalArgs.map((arg: string) =>  `[${arg}]`).join(" ");
            content += ` - \`££PREFIX££${b.prefix}\` ${requiredArgs} ${optionalArgs} - ${b.help}\n`;
            // We know that this is safe.
            botCommands[b.prefix as string] = {
                fn: prototype[propetyKey],
                requiredArgs: b.requiredArgs,
                optionalArgs: b.optionalArgs,
                includeUserId: b.includeUserId,
            };
        }
    });
    return {
        helpMessage: (cmdPrefix?: string) => ({
            msgtype: "m.notice",
            body: content,
            formatted_body: md.render(content).replace(/££PREFIX££/g, cmdPrefix || ""),
            format: "org.matrix.custom.html"
        }),
        botCommands,
    }
}

export async function handleCommand(userId: string, command: string, botCommands: BotCommands, obj: unknown, prefix?: string): Promise<{error?: string, handled?: boolean, humanError?: string}> {
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
            if (command.requiredArgs.length > parts.length - i) {
                return {error: "Missing args"};
            }
            const args = parts.slice(i);
            if (command.includeUserId) {
                args.splice(0,0, userId);
            }
            try {
                await botCommands[prefix].fn.apply(obj,  args);
                return {handled: true};
            } catch (ex) {
                return {handled: true, error: ex.message, humanError: ex.humanError};
            }
        }
    }
    return {handled: false};
}