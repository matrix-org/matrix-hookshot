import assert from "assert";
import { hideKey } from "../Decorators";
import { OpenProjectServiceConfig } from "../../Connections/OpenProjectConnection";

export interface BridgeOpenProjectOAuthConfig{
        clientId: string;
        clientSecret: string;
        redirectUri: string;
    }

export interface BridgeOpenProjectConfigYAML {
    webhook: {
        secret: string;
    }
    baseUrl: string;
    oauth?: BridgeOpenProjectOAuthConfig
}

function makePrefixedUrl(urlString?: string): URL {
    return new URL(urlString?.endsWith("/") ? urlString : urlString + "/");
}
export class BridgeOpenProjectConfig {
    webhookSecret: string;
    baseURL: URL;
    oauth?: BridgeOpenProjectOAuthConfig;

    constructor(config: BridgeOpenProjectConfigYAML) {
        assert(config.webhook?.secret);
        this.webhookSecret = config.webhook.secret;
        this.baseURL = makePrefixedUrl(config.baseUrl);
        if (config.oauth) {
            assert(config.oauth.clientId);
            assert(config.oauth.clientSecret);
            assert(config.oauth.redirectUri);
            this.oauth = config.oauth;
        }
    }

    @hideKey()
    public get publicConfig(): OpenProjectServiceConfig {
        return {
            baseUrl: this.baseURL.origin + this.baseURL.pathname
        }
    }
}