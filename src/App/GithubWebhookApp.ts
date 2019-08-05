import { parseConfig } from "../Config";
import { GithubWebhooks } from "../GithubWebhooks";

class GithubWebhookApp {
    constructor () {
        
    }

    public async start() {
        const configFile = process.argv[2] || "./config.yml";
        const config = await parseConfig(configFile);
        const webhookHandler = new GithubWebhooks(config);
        webhookHandler.listen();
    }

}

new GithubWebhookApp().start().catch((ex) => {
    console.error("Bridge encountered an error and has stopped:", ex);
});