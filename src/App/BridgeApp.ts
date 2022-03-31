import { Bridge } from "../Bridge";
import LogWrapper from "../LogWrapper";

import { BridgeConfig, parseRegistrationFile } from "../Config/Config";
import { Webhooks } from "../Webhooks";
import { MatrixSender } from "../MatrixSender";
import { UserNotificationWatcher } from "../Notifications/UserNotificationWatcher";
import { ListenerService } from "../ListenerService";

LogWrapper.configureLogging("info");
const log = new LogWrapper("App");

async function start() {
    const configFile = process.argv[2] || "./config.yml";
    const registrationFile = process.argv[3] || "./registration.yml";
    const config = await BridgeConfig.parseConfig(configFile, process.env);
    const registration = await parseRegistrationFile(registrationFile);
    const listener = new ListenerService(config.listeners);
    LogWrapper.configureLogging(config.logging);

    if (config.queue.monolithic) {
        const webhookHandler = new Webhooks(config);
        listener.bindResource('webhooks', webhookHandler.expressRouter);
        const matrixSender = new MatrixSender(config, registration);
        matrixSender.listen();
        const userNotificationWatcher = new UserNotificationWatcher(config);
        userNotificationWatcher.start();
    }

    const bridgeApp = new Bridge(config, registration, listener);

    process.once("SIGTERM", () => {
        log.error("Got SIGTERM");
        listener.stop();
        bridgeApp.stop();
    });
    await bridgeApp.start();
    listener.start();
}

start().catch((ex) => {
    log.error("BridgeApp encountered an error and has stopped:", ex);
    process.exit(1);
});
