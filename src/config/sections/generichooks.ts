import { ConfigError } from "../../errors";
import { hideKey } from "../Decorators";
import parseDuration from "parse-duration";

function makePrefixedUrl(urlString: string): URL {
    return new URL(urlString.endsWith("/") ? urlString : urlString + "/");
}

export interface BridgeGenericWebhooksConfigYAML {
    enabled: boolean;
    urlPrefix: string;
    userIdPrefix?: string;
    allowJsTransformationFunctions?: boolean;
    waitForComplete?: boolean;
    enableHttpGet?: boolean;
    outbound?: boolean;
    disallowedIpRanges?: string[];
    maxExpiryTime?: string;
}

export class BridgeConfigGenericWebhooks {
    public readonly enabled: boolean;
    public readonly outbound: boolean;

    @hideKey()
    public readonly parsedUrlPrefix: URL;
    public readonly urlPrefix: () => string;

    public readonly userIdPrefix?: string;
    public readonly allowJsTransformationFunctions?: boolean;
    public readonly waitForComplete?: boolean;
    public readonly enableHttpGet: boolean;
    public readonly maxExpiryTime?: number;

    constructor(yaml: BridgeGenericWebhooksConfigYAML) {
        this.enabled = yaml.enabled || false;
        this.outbound = yaml.outbound || false;
        this.enableHttpGet = yaml.enableHttpGet || false;
        try {
            this.parsedUrlPrefix = makePrefixedUrl(yaml.urlPrefix);
            this.urlPrefix = () => { return this.parsedUrlPrefix.href; }
        } catch (err) {
            throw new ConfigError("generic.urlPrefix", "is not defined or not a valid URL");
        }
        this.userIdPrefix = yaml.userIdPrefix;
        this.allowJsTransformationFunctions = yaml.allowJsTransformationFunctions;
        this.waitForComplete = yaml.waitForComplete;
        this.maxExpiryTime = yaml.maxExpiryTime ? parseDuration(yaml.maxExpiryTime) : undefined;
    }

    @hideKey()
    public get publicConfig() {
        return {
            userIdPrefix: this.userIdPrefix,
            allowJsTransformationFunctions: this.allowJsTransformationFunctions,
            waitForComplete: this.waitForComplete,
            maxExpiryTime: this.maxExpiryTime,
        }
    }

}
