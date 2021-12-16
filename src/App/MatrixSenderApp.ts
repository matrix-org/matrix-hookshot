import { BridgeConfig, parseRegistrationFile } from "../Config/Config";
import { MatrixSender } from "../MatrixSender";
import LogWrapper from "../LogWrapper";
import Metrics from "../Metrics";


const log = new LogWrapper("App");

async function start() {
    const configFile = process.argv[2] || "./config.yml";
    const registrationFile = process.argv[3] || "./registration.yml";
    const config = await BridgeConfig.parseConfig(configFile, process.env);
    const registration = await parseRegistrationFile(registrationFile);
    LogWrapper.configureLogging(config.logging.level);
    const sender = new MatrixSender(config, registration);
    if (config.metrics) {
        if (!config.metrics.port) {
            log.warn(`Not running metrics for service, no port specified`);
        } else {
            Metrics.start(config.metrics);
        }
    }
    sender.listen();
    process.once("SIGTERM", () => {
        log.error("Got SIGTERM");
        sender.stop();
        Metrics.stop();
    });
}

start().catch((ex) => {
    log.error("MatrixSenderApp encountered an error and has stopped:", ex);
});
