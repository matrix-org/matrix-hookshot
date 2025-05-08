import assert from "assert";

export interface BridgeOpenProjectConfigYAML {
    webhook: {
        secret: string;
    }
}

export class BridgeOpenProjectConfig {
    webhookSecret: string;

    constructor(config: BridgeOpenProjectConfigYAML) {
        assert(config.webhook?.secret);
        this.webhookSecret = config.webhook.secret;
    }
}