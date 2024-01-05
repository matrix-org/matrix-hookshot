import { BridgeConfig } from "../config/Config";
import { Webhooks } from "../Webhooks";
import { Logger } from "matrix-appservice-bridge";
import { UserNotificationWatcher } from "../Notifications/UserNotificationWatcher";
import Metrics from "../Metrics";
import { ListenerService } from "../ListenerService";
import { LogService } from "matrix-bot-sdk";


const log = new Logger("App");

async function start() {
    const configFile = process.argv[2] || "./config.yml";
    const config = await BridgeConfig.parseConfig(configFile, process.env);
    Logger.configure({
        console: config.logging.level,
        colorize: config.logging.colorize,
        json: config.logging.json,
        timestampFormat: config.logging.timestampFormat
    });
    LogService.setLogger(Logger.botSdkLogger);
    const listener = new ListenerService(config.listeners);
    listener.start();
    if (config.metrics) {
        if (!config.metrics.port) {
            log.warn(`Not running metrics for service, no port specified`);
        } else {
            listener.bindResource('metrics', Metrics.expressRouter);
        }
    }
    const webhookHandler = new Webhooks(config);
    listener.bindResource('webhooks', webhookHandler.expressRouter);
    listener.finaliseListeners();
    const userWatcher = new UserNotificationWatcher(config);
    userWatcher.start();
    process.once("SIGTERM", () => {
        log.error("Got SIGTERM");
        webhookHandler.stop();
        listener.stop();
        userWatcher.stop();
    });
}

start().catch((ex) => {
    log.error("GithubWebhookApp encountered an error and has stopped:", ex);
});
