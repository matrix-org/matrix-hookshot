import markdown from "markdown-it";
// @ts-ignore
import argvSplit from "argv-split";
import e from "express";

const md = new markdown();

export const botCommandSymbol = Symbol("botCommandMetadata");
export function botCommand(prefix: string, help: string, requiredArgs: string[] = [], optionalArgs: string[] = [], includeUserId: boolean = false) {
    return Reflect.metadata(botCommandSymbol, {
        prefix,
        help,
        requiredArgs,
        optionalArgs,
        includeUserId,
    });
}

export type BotCommands = {[prefix: string]: {
    fn: (...args: string[]) => Promise<{status: boolean}>,
    requiredArgs: string[],
    optionalArgs: string[],
    includeUserId: boolean,
}};

export function compileBotCommands(prototype: any): {helpMessage: any, botCommands: BotCommands} {
    let content = "Commands:\n";
    let botCommands: BotCommands = {};
    Object.getOwnPropertyNames(prototype).forEach(propetyKey => {
        const b = Reflect.getMetadata(botCommandSymbol, prototype, propetyKey);
        if (b) {
            const requiredArgs = b.requiredArgs.join((arg: string) =>  `__${arg}__`);
            const optionalArgs = b.optionalArgs.join((arg: string) =>  `\[${arg}\]`);
            content += ` - \`${b.prefix}\` ${requiredArgs} ${optionalArgs} - ${b.help}\n`;
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
        helpMessage: {
            msgtype: "m.notice",
            body: content,
            formatted_body: md.render(content),
            format: "org.matrix.custom.html"
        },
        botCommands,
    }
}

export async function handleCommand(userId: string, command: string, botCommands: BotCommands, obj: any): Promise<{error?: string, handled?: boolean}> {
    const cmdLower = command.toLowerCase();
    const parts = argvSplit(cmdLower);
    for (let i = parts.length; i > 0; i--) {
        const prefix = parts.slice(0, i).join(" ");
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
                return {handled: true, error: ex.message};
            }
        }
    }
    return {handled: false};
}