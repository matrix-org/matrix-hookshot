import { LogService } from "matrix-bot-sdk";
import util from "util";
import winston from "winston";

// Logs contain unknowns, ignore this.
// tslint:disable: no-any

export class LogWrapper {

    public static configureLogging(level: string) {
        const log = winston.createLogger({
            level,
            transports: [
                new winston.transports.Console({
                    format: winston.format.combine(
                        winston.format.timestamp({
                            format: "HH:mm:ss:SSS",
                        }),
                        winston.format.printf(
                        (info) => {
                            return `${info.level.toUpperCase()} ${info.timestamp} [${info.module}] ${info.message}`;
                        },
                    )),
                }),
            ],
        });
        const getMessageString = (...messageOrObject: any[]) => {
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
            info: (module: string, ...messageOrObject: any[]) => {
                log.info(getMessageString(messageOrObject), { module });
            },
            warn: (module: string, ...messageOrObject: any[]) => {
                log.warn(getMessageString(messageOrObject), { module });
            },
            error: (module: string, ...messageOrObject: any[]) => {
                log.error(getMessageString(messageOrObject), { module });
            },
            debug: (module: string, ...messageOrObject: any[]) => {
                log.debug(getMessageString(messageOrObject), { module });
            },
        });
        LogService.info("LogWrapper", "Reconfigured logging");
    }

    constructor(private module: string) { }

    /**
     * Logs to the DEBUG channel
     * @param {string} module The module being logged
     * @param {*[]} messageOrObject The data to log
     */
    public debug(...messageOrObject: any[]) {
        LogService.debug(this.module, ...messageOrObject);
    }

    /**
     * Logs to the ERROR channel
     * @param {*[]} messageOrObject The data to log
     */
    public error(...messageOrObject: any[]) {
        LogService.error(this.module, ...messageOrObject);
    }

    /**
     * Logs to the INFO channel
     * @param {*[]} messageOrObject The data to log
     */
    public info(...messageOrObject: any[]) {
        LogService.info(this.module, ...messageOrObject);
    }

    /**
     * Logs to the WARN channel
     * @param {*[]} messageOrObject The data to log
     */
    public warn(...messageOrObject: any[]) {
        LogService.warn(this.module, ...messageOrObject);
    }
}
