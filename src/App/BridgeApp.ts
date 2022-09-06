import { Bridge } from "../Bridge";
import LogWrapper from "../LogWrapper";

import { BridgeConfig, parseRegistrationFile } from "../Config/Config";
import { Webhooks } from "../Webhooks";
import { MatrixSender } from "../MatrixSender";
import { UserNotificationWatcher } from "../Notifications/UserNotificationWatcher";
import { ListenerService } from "../ListenerService";
import { Logging } from "matrix-appservice-bridge";

LogWrapper.root.configureLogging({level: "info"});
const log = new LogWrapper("App");

async function start() {
    const configFile = process.argv[2] || "./config.yml";
    const registrationFile = process.argv[3] || "./registration.yml";
    const config = await BridgeConfig.parseConfig(configFile, process.env);
    const registration = await parseRegistrationFile(registrationFile);
    const listener = new ListenerService(config.listeners);
    LogWrapper.root.configureLogging(config.logging);
    // Bridge SDK doesn't support trace, use "debug" instead.
    const bridgeSdkLevel = config.logging.level === "trace" ? "debug" : config.logging.level;
    Logging.configure({console: bridgeSdkLevel });

    if (config.queue.monolithic) {
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

    // XXX: Since the webhook listener listens on /, it must listen AFTER other resources
    // have bound themselves.
    if (config.queue.monolithic) {
        const webhookHandler = new Webhooks(config);
        listener.bindResource('webhooks', webhookHandler.expressRouter);
    }

    listener.start();
}

start().catch((ex) => {
    if (LogWrapper.root.configured) {
        log.error("BridgeApp encountered an error and has stopped:", ex);
    } else {
        // eslint-disable-next-line no-console
        console.error("BridgeApp encountered an error and has stopped", ex);
    }
    process.exit(1);
});
