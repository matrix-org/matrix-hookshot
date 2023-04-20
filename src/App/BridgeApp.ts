import { Bridge } from "../Bridge";

import { BridgeConfig, parseRegistrationFile } from "../Config/Config";
import { Webhooks } from "../Webhooks";
import { MatrixSender } from "../MatrixSender";
import { UserNotificationWatcher } from "../Notifications/UserNotificationWatcher";
import { ListenerService } from "../ListenerService";
import { Logger } from "matrix-appservice-bridge";
import { LogService } from "matrix-bot-sdk";
import { getAppservice } from "../appservice";
import BotUsersManager from "../Managers/BotUsersManager";

Logger.configure({console: "info"});
const log = new Logger("App");

async function start() {
    const configFile = process.argv[2] || "./config.yml";
    const registrationFile = process.argv[3] || "./registration.yml";
    const config = await BridgeConfig.parseConfig(configFile, process.env);
    const registration = await parseRegistrationFile(registrationFile);
    const listener = new ListenerService(config.listeners);
    listener.start();
    Logger.configure({
        console: config.logging.level,
        colorize: config.logging.colorize,
        json: config.logging.json,
        timestampFormat: config.logging.timestampFormat
    });
    LogService.setLogger(Logger.botSdkLogger);

    const {appservice, storage} = getAppservice(config, registration);

    if (config.queue.monolithic) {
        const matrixSender = new MatrixSender(config, appservice);
        matrixSender.listen();
        const userNotificationWatcher = new UserNotificationWatcher(config);
        userNotificationWatcher.start();
    }

    const botUsersManager = new BotUsersManager(config, appservice);

    const bridgeApp = new Bridge(config, listener, appservice, storage, botUsersManager);

    process.once("SIGTERM", () => {
        log.error("Got SIGTERM");
        listener.stop();
        bridgeApp.stop();
        // Don't care to await this, as the process is about to end
        storage.disconnect?.();
    });
    await bridgeApp.start();

    // XXX: Since the webhook listener listens on /, it must listen AFTER other resources
    // have bound themselves.
    if (config.queue.monolithic) {
        const webhookHandler = new Webhooks(config);
        listener.bindResource('webhooks', webhookHandler.expressRouter);
    }
}

start().catch((ex) => {
    if (Logger.root.configured) {
        log.error("BridgeApp encountered an error and has stopped:", ex);
    } else {
        // eslint-disable-next-line no-console
        console.error("BridgeApp encountered an error and has stopped", ex);
    }
    process.exit(1);
});
