import { GithubBridge } from "../GithubBridge";
import LogWrapper from "../LogWrapper";

import { BridgeConfig, parseRegistrationFile } from "../Config/Config";
import { Webhooks } from "../Webhooks";
import { MatrixSender } from "../MatrixSender";
import { UserNotificationWatcher } from "../Notifications/UserNotificationWatcher";
LogWrapper.configureLogging("debug");
const log = new LogWrapper("App");

async function start() {
    const configFile = process.argv[2] || "./config.yml";
    const registrationFile = process.argv[3] || "./registration.yml";
    const config = await BridgeConfig.parseConfig(configFile, process.env);
    const registration = await parseRegistrationFile(registrationFile);
    LogWrapper.configureLogging(config.logging.level);

    if (config.queue.monolithic) {
        const webhookHandler = new Webhooks(config);
        webhookHandler.listen();
        const matrixSender = new MatrixSender(config, registration);
        matrixSender.listen();
        const userNotificationWatcher = new UserNotificationWatcher(config);
        userNotificationWatcher.start();
    }

    const bridgeApp = new GithubBridge(config, registration);

    process.once("SIGTERM", () => {
        log.error("Got SIGTERM");
        bridgeApp.stop();
    });
    await bridgeApp.start();
}

start().catch((ex) => {
    log.error("BridgeApp encountered an error and has stopped:", ex);
    process.exit(1);
});
