import { BridgeConfig } from "../Config/Config";
import { Webhooks } from "../Webhooks";
import LogWrapper from "../LogWrapper";
import { UserNotificationWatcher } from "../Notifications/UserNotificationWatcher";


const log = new LogWrapper("App");

async function start() {
    const configFile = process.argv[2] || "./config.yml";
    const config = await BridgeConfig.parseConfig(configFile, process.env);
    LogWrapper.configureLogging(config.logging.level);
    const webhookHandler = new Webhooks(config);
    webhookHandler.listen();
    const userWatcher = new UserNotificationWatcher(config);
    userWatcher.start();
    process.once("SIGTERM", () => {
        log.error("Got SIGTERM");
        webhookHandler.stop();
        userWatcher.stop();
    });
}

start().catch((ex) => {
    log.error("GithubWebhookApp encountered an error and has stopped:", ex);
});
