import { BridgeConfig, parseRegistrationFile } from "../config/Config";
import { MatrixSender } from "../MatrixSender";
import { Logger } from "matrix-appservice-bridge";
import Metrics from "../Metrics";
import { ListenerService } from "../ListenerService";
import { LogService } from "matrix-bot-sdk";
import { getAppservice } from "../appservice";


const log = new Logger("App");

async function start() {
    const configFile = process.argv[2] || "./config.yml";
    const registrationFile = process.argv[3] || "./registration.yml";
    const config = await BridgeConfig.parseConfig(configFile, process.env);
    const registration = await parseRegistrationFile(registrationFile);
    Logger.configure({
        console: config.logging.level,
        colorize: config.logging.colorize,
        json: config.logging.json,
        timestampFormat: config.logging.timestampFormat
    });
    LogService.setLogger(Logger.botSdkLogger);
    const listener = new ListenerService(config.listeners);
    listener.start();
    const {appservice, storage} = getAppservice(config, registration);
    const sender = new MatrixSender(config, appservice);
    if (config.metrics) {
        if (!config.metrics.port) {
            log.warn(`Not running metrics for service, no port specified`);
        } else {
            listener.bindResource('metrics', Metrics.expressRouter);
        }
    }
    listener.finaliseListeners();
    sender.listen();
    process.once("SIGTERM", () => {
        log.error("Got SIGTERM");
        sender.stop();
        listener.stop();
        storage.disconnect?.();
    });
}

start().catch((ex) => {
    log.error("MatrixSenderApp encountered an error and has stopped:", ex);
});
