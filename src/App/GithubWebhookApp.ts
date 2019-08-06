import { parseConfig } from "../Config";
import { GithubWebhooks } from "../GithubWebhooks";

async function start() {
    const configFile = process.argv[2] || "./config.yml";
    const config = await parseConfig(configFile, process.env);
    const webhookHandler = new GithubWebhooks(config);
    webhookHandler.listen();
}
start().catch((ex) => {
    console.error("GithubWebhookApp encountered an error and has stopped:", ex);
});
