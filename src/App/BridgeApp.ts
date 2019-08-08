import { GithubBridge } from "../GithubBridge";
import { LogWrapper } from "../LogWrapper";
import { parseConfig, parseRegistrationFile } from "../Config";
import { GithubWebhooks } from "../GithubWebhooks";
import { MatrixSender } from "../MatrixSender";

const log = new LogWrapper("App");

async function start() {
    const configFile = process.argv[2] || "./config.yml";
    const registrationFile = process.argv[3] || "./registration.yml";
    const config = await parseConfig(configFile, process.env);
    const registration = await parseRegistrationFile(registrationFile);
    LogWrapper.configureLogging(config.logging.level);

    if (config.queue.monolithic) {
        const webhookHandler = new GithubWebhooks(config);
        webhookHandler.listen();
        const matrixSender = new MatrixSender(config, registration);
        matrixSender.listen();
    }

    const bridgeApp = new GithubBridge(config, registration);
    await bridgeApp.start();
}
start().catch((ex) => {
    log.error("BridgeApp encountered an error and has stopped:", ex);
});
