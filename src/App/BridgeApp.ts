import { GithubBridge } from "../GithubBridge";
import { LogWrapper } from "../LogWrapper";

const log = new LogWrapper("App");

async function start() {
    LogWrapper.configureLogging();
    const bridgeApp = new GithubBridge();
    await bridgeApp.start();
}
start().catch((ex) => {
    log.error("BridgeApp encountered an error and has stopped:", ex);
});
