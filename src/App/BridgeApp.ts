import { GithubBridge } from "../GithubBridge";
import { LogWrapper } from "../LogWrapper";
import { parseConfig } from "../Config";

const log = new LogWrapper("App");

async function start() {
    const configFile = process.argv[2] || "./config.yml";
    const config = await parseConfig(configFile, process.env);
    LogWrapper.configureLogging(config.logging.level);
    const bridgeApp = new GithubBridge(config);
    await bridgeApp.start();
}
start().catch((ex) => {
    log.error("BridgeApp encountered an error and has stopped:", ex);
});
