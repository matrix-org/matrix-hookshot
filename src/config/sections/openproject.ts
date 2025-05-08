import assert from "assert";

export interface BridgeOpenProjectConfigYAML {
    webhook: {
        secret: string;
    }
    baseUrl: string;
}

function makePrefixedUrl(urlString?: string): URL {
    return new URL(urlString?.endsWith("/") ? urlString : urlString + "/");
}
export class BridgeOpenProjectConfig {
    webhookSecret: string;
    baseURL: URL;

    constructor(config: BridgeOpenProjectConfigYAML) {
        assert(config.webhook?.secret);
        this.webhookSecret = config.webhook.secret;
        this.baseURL = makePrefixedUrl(config.baseUrl);
    }
}