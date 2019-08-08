import { parseConfig, parseRegistrationFile } from "../Config";
import { MatrixSender } from "../MatrixSender";
import { LogWrapper } from "../LogWrapper";

const log = new LogWrapper("App");

async function start() {
    const configFile = process.argv[2] || "./config.yml";
    const registrationFile = process.argv[3] || "./registration.yml";
    const config = await parseConfig(configFile, process.env);
    const registration = await parseRegistrationFile(registrationFile);
    LogWrapper.configureLogging(config.logging.level);
    new MatrixSender(config, registration).listen();
}

start().catch((ex) => {
    log.error("MatrixSenderApp encountered an error and has stopped:", ex);
});
