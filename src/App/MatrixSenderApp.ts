import { BridgeConfig, parseRegistrationFile } from "../Config/Config";
import { MatrixSender } from "../MatrixSender";
import LogWrapper from "../LogWrapper";
import Metrics from "../Metrics";
import { ListenerService } from "../ListenerService";


const log = new LogWrapper("App");

async function start() {
    const configFile = process.argv[2] || "./config.yml";
    const registrationFile = process.argv[3] || "./registration.yml";
    const config = await BridgeConfig.parseConfig(configFile, process.env);
    const registration = await parseRegistrationFile(registrationFile);
    LogWrapper.configureLogging(config.logging);
    const listener = new ListenerService(config.listeners);
    const sender = new MatrixSender(config, registration);
    if (config.metrics) {
        if (!config.metrics.port) {
            log.warn(`Not running metrics for service, no port specified`);
        } else {
            listener.bindResource('metrics', Metrics.expressRouter);
        }
    }
    sender.listen();
    listener.start();
    process.once("SIGTERM", () => {
        log.error("Got SIGTERM");
        sender.stop();
        listener.stop();
    });
}

start().catch((ex) => {
    log.error("MatrixSenderApp encountered an error and has stopped:", ex);
});
