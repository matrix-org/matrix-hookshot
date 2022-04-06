import { LogLevel, LogService } from "matrix-bot-sdk";
import util from "util";
import winston, { format } from "winston";
import { BridgeConfigLogging } from "./Config/Config";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MsgType = string|Error|any|{error?: string};

function isMessageNoise(messageOrObject: MsgType[]) {
    const error = messageOrObject[0]?.error || messageOrObject[1]?.error ||messageOrObject[1]?.body?.error;
    const errcode = messageOrObject[0]?.errcode || messageOrObject[1]?.errcode;
    if (errcode === "M_NOT_FOUND" && error === "Room account data not found") {
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
export default class LogWrapper {

    public static configureLogging(cfg: BridgeConfigLogging) {

        if (typeof cfg === "string") {
            cfg = { level: cfg };
        }

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
            formatters.push(winston.format.json());
        } else {
            formatters.push(winston.format.printf(
                (info) => {
                    return `${info.level} ${info.timestamp} [${info.module}] ${info.message}`;
                },
            ));
        }


        const log = winston.createLogger({
            level: cfg.level,
            transports: [
                new winston.transports.Console({
                    format: winston.format.combine(...formatters),
                }),
            ],
        });
        const getMessageString = (messageOrObject: MsgType[]) => {
            messageOrObject = messageOrObject.flat();
            const messageParts: string[] = [];
            messageOrObject.forEach((obj) => {
                if (typeof(obj) === "string") {
                    messageParts.push(obj);
                    return;
                }
                messageParts.push(util.inspect(obj));
            });
            return messageParts.join(" ");
        };
        LogService.setLogger({
            info: (module: string, ...messageOrObject: MsgType[]) => {
                // These are noisy, redirect to debug.
                if (module.startsWith("MatrixLiteClient")) {
                    log.debug(getMessageString(messageOrObject), { module });
                    return;
                }
                log.info(getMessageString(messageOrObject), { module });
            },
            warn: (module: string, ...messageOrObject: MsgType[]) => {
                if (isMessageNoise(messageOrObject)) {
                    log.debug(getMessageString(messageOrObject), { module });
                    return; // This is just noise :|
                }
                log.warn(getMessageString(messageOrObject), { module });
            },
            error: (module: string, ...messageOrObject: MsgType[]) => {
                if (isMessageNoise(messageOrObject)) {
                    log.debug(getMessageString(messageOrObject), { module });
                    return; // This is just noise :|
                }
                log.error(getMessageString(messageOrObject), { module });
            },
            debug: (module: string, ...messageOrObject: MsgType[]) => {
                log.debug(getMessageString(messageOrObject), { module });
            },
            trace: (module: string, ...messageOrObject: MsgType[]) => {
                log.verbose(getMessageString(messageOrObject), { module });
            },
        });
        LogService.setLevel(LogLevel.fromString(cfg.level));
        LogService.debug("LogWrapper", "Reconfigured logging");
    }

    constructor(private module: string) { }

    /**
     * Logs to the DEBUG channel
     * @param {string} module The module being logged
     * @param {*[]} messageOrObject The data to log
     */
    public debug(...messageOrObject: MsgType[]) {
        LogService.debug(this.module, ...messageOrObject);
    }

    /**
     * Logs to the ERROR channel
     * @param {*[]} messageOrObject The data to log
     */
    public error(...messageOrObject: MsgType[]) {
        LogService.error(this.module, ...messageOrObject);
    }

    /**
     * Logs to the INFO channel
     * @param {*[]} messageOrObject The data to log
     */
    public info(...messageOrObject: MsgType[]) {
        LogService.info(this.module, ...messageOrObject);
    }

    /**
     * Logs to the WARN channel
     * @param {*[]} messageOrObject The data to log
     */
    public warn(...messageOrObject: MsgType[]) {
        LogService.warn(this.module, ...messageOrObject);
    }
}
