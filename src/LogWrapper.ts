import { LogLevel, LogService } from "matrix-bot-sdk";
import util from "util";
import winston, { format } from "winston";
import { BridgeConfigLogging } from "./Config/Config";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MsgType = string|Error|any|{error?: string};

function isMessageNoise(messageOrObject: MsgType[]) {
    const error = messageOrObject[0]?.error || messageOrObject[1]?.error || messageOrObject[1]?.body?.error;
    const errcode = messageOrObject[0]?.errcode || messageOrObject[1]?.errcode;
    if (errcode === "M_NOT_FOUND" && error === "Room account data not found") {
        return true;
    }
    if (errcode === "M_NOT_FOUND" && error === "Account data not found") {
        return true;
    }
    if (errcode === "M_NOT_FOUND" && error === "Event not found.") {
        return true;
    }
    if (errcode === "M_USER_IN_USE") {
        return true;
    }
    return false;
}

interface HookshotLogInfo extends winston.Logform.TransformableInfo {
    data: MsgType[];
}
export class GlobalLogger {
    private isConfigured = false;

    public get configured() {
        return this.isConfigured;
    }

    private winstonLog?: winston.Logger;

    public get winston() {
        return this.winstonLog;
    }

    public configureLogging(cfg: BridgeConfigLogging, debugStream?: NodeJS.WritableStream) {
        if (typeof cfg === "string") {
            cfg = { level: cfg };
        }

        this.winstonLog?.close();

        const formatters = [
            winston.format.timestamp({
                format: cfg.timestampFormat || "HH:mm:ss:SSS",
            }),
            (format((info) => {
                info.level = info.level.toUpperCase();
                return info;
            }))(),
        ]

        if (!cfg.json && cfg.colorize) {
            formatters.push(
                winston.format.colorize({
                    level: true,
                })
            );
        }

        if (cfg.json) {
            formatters.push((format((info) => {
                const hsData = [...(info as HookshotLogInfo).data];
                const firstArg = hsData.shift() ?? 'undefined';
                const result: winston.Logform.TransformableInfo = {
                    level: info.level,
                    module: info.module,
                    timestamp: info.timestamp,
                    // Find the first instance of an error, subsequent errors are treated as args.
                    error: hsData.find(d => d instanceof Error)?.message,
                    message: "", // Always filled out
                    args: hsData.length ? hsData : undefined,
                };

                if (typeof firstArg === "string") {
                    result.message = firstArg;
                } else if (firstArg instanceof Error) {
                    result.message = firstArg.message;
                } else {
                    result.message = util.inspect(firstArg);
                }

                return result;
            }))()),
            formatters.push(winston.format.json());
        } else {
            formatters.push(winston.format.printf(i => LogWrapper.messageFormatter(i as HookshotLogInfo)));
        }

        const formatter = winston.format.combine(...formatters);
        const log = this.winstonLog = winston.createLogger({
            level: cfg.level,
            transports: [
                debugStream ? new winston.transports.Stream({
                    stream: debugStream,
                    format: formatter,
                }) :
                new winston.transports.Console({
                    format: formatter,
                }),
            ],
        });

        function formatBotSdkMessage(module: string, ...messageOrObject: MsgType[]) {
            return {
                module,
                data: [LogWrapper.formatMsgTypeArray(messageOrObject)]
            };
        }

        LogService.setLogger({
            info: (module: string, ...messageOrObject: MsgType[]) => {
                // These are noisy, redirect to debug.
                if (module.startsWith("MatrixLiteClient") || module.startsWith("MatrixHttpClient")) {
                    log.log("debug", formatBotSdkMessage(module, ...messageOrObject));
                    return;
                }
                log.log("info", formatBotSdkMessage(module, ...messageOrObject));
            },
            warn: (module: string, ...messageOrObject: MsgType[]) => {
                if (isMessageNoise(messageOrObject)) {
                    log.log("debug", formatBotSdkMessage(module, ...messageOrObject));
                    return;
                }
                log.log("warn", formatBotSdkMessage(module, ...messageOrObject));
            },
            error: (module: string, ...messageOrObject: MsgType[]) => {
                if (isMessageNoise(messageOrObject)) {
                    log.log("debug", formatBotSdkMessage(module, ...messageOrObject));
                    return;
                }
                log.log("error", formatBotSdkMessage(module, ...messageOrObject));
            },
            debug: (module: string, ...messageOrObject: MsgType[]) => {
                log.log("debug", formatBotSdkMessage(module, ...messageOrObject));
            },
            trace: (module: string, ...messageOrObject: MsgType[]) => {
                log.log("verbose", formatBotSdkMessage(module, ...messageOrObject));
            },
        });

        LogService.setLevel(LogLevel.fromString(cfg.level));
        LogService.debug("LogWrapper", "Reconfigured logging");
        this.isConfigured = true;
    }
}
export default class LogWrapper {
    static readonly root = new GlobalLogger();

    static formatMsgTypeArray(...data: MsgType[]): string {
        data = data.flat();
        return data.map(obj => {
            if (typeof obj === "string") {
                return obj;
            }
            return util.inspect(obj);
        }).join(" ");
    }

    static messageFormatter(info: HookshotLogInfo): string {
        const logPrefix = `${info.level} ${info.timestamp} [${info.module}] `;
        return logPrefix + this.formatMsgTypeArray(info.data ?? []);
    }

    constructor(private module: string, private readonly logger: GlobalLogger = LogWrapper.root) {
    }

    /**
     * Logs to the DEBUG channel
     * @param msg The message or data to log.
     * @param additionalData Additional context.
     */
    public debug(msg: MsgType, ...additionalData: MsgType[]) {
        this.logger.winston?.log("debug", { module: this.module, data: [msg, ...additionalData] });
    }

    /**
     * Logs to the ERROR channel
     * @param msg The message or data to log.
     * @param additionalData Additional context.
     */
    public error(msg: MsgType, ...additionalData: MsgType[]) {
        this.logger.winston?.log("error", { module: this.module, data: [msg, ...additionalData] });
    }

    /**
     * Logs to the INFO channel
     * @param msg The message or data to log.
     * @param additionalData Additional context.
     */
    public info(msg: MsgType, ...additionalData: MsgType[]) {
        this.logger.winston?.log("info", { module: this.module, data: [msg, ...additionalData] });
    }

    /**
     * Logs to the WARN channel
     * @param msg The message or data to log.
     * @param additionalData Additional context.
     */
    public warn(msg: MsgType, ...additionalData: MsgType[]) {
        this.logger.winston?.log("warn", { module: this.module, data: [msg, ...additionalData] });
    }
}
