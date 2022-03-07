import { BridgeConfig } from "../Config/Config";
import { Webhooks } from "../Webhooks";
import LogWrapper from "../LogWrapper";
import { UserNotificationWatcher } from "../Notifications/UserNotificationWatcher";
import Metrics from "../Metrics";
import { ListenerService } from "../ListenerService";


const log = new LogWrapper("App");

async function start() {
    const configFile = process.argv[2] || "./config.yml";
    const config = await BridgeConfig.parseConfig(configFile, process.env);
    LogWrapper.configureLogging(config.logging);
    const listener = new ListenerService(config.listeners);
    if (config.metrics) {
        if (!config.metrics.port) {
            log.warn(`Not running metrics for service, no port specified`);
        } else {
            listener.bindResource('metrics', Metrics.expressRouter);
        }
    }
    const webhookHandler = new Webhooks(config);
    listener.bindResource('webhooks', webhookHandler.expressRouter);
    const userWatcher = new UserNotificationWatcher(config);
    userWatcher.start();
    listener.start();
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
