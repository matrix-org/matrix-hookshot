import { parseConfig } from "../Config";
import { GithubWebhooks } from "../GithubWebhooks";
import { LogWrapper } from "../LogWrapper";

const log = new LogWrapper("App");

async function start() {
    const configFile = process.argv[2] || "./config.yml";
    const config = await parseConfig(configFile, process.env);
    LogWrapper.configureLogging(config.logging.level);
    const webhookHandler = new GithubWebhooks(config);
    webhookHandler.listen();
}
start().catch((ex) => {
    log.error("GithubWebhookApp encountered an error and has stopped:", ex);
});
