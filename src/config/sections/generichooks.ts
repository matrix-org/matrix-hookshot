import { GenericHookServiceConfig } from "../../Connections";
import { ConfigError } from "../../errors";
import { hideKey } from "../Decorators";
const parseDurationImport = import("parse-duration");

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
    sendExpiryNotice?: boolean;
    requireExpiryTime?: boolean;
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

    @hideKey()
    public readonly maxExpiryTimeMs?: Promise<number|undefined>;
    public readonly sendExpiryNotice: boolean;
    public readonly requireExpiryTime: boolean;
    // Public facing value for config generator
    public readonly maxExpiryTime?: string;

    constructor(yaml: BridgeGenericWebhooksConfigYAML) {
        this.enabled = yaml.enabled || false;
        this.outbound = yaml.outbound || false;
        this.enableHttpGet = yaml.enableHttpGet || false;
        this.sendExpiryNotice = yaml.sendExpiryNotice || false;
        this.requireExpiryTime = yaml.requireExpiryTime || false;
        try {
            this.parsedUrlPrefix = makePrefixedUrl(yaml.urlPrefix);
            this.urlPrefix = () => { return this.parsedUrlPrefix.href; }
        } catch (err) {
            throw new ConfigError("generic.urlPrefix", "is not defined or not a valid URL");
        }
        this.userIdPrefix = yaml.userIdPrefix;
        this.allowJsTransformationFunctions = yaml.allowJsTransformationFunctions;
        this.waitForComplete = yaml.waitForComplete;
        this.maxExpiryTime = yaml.maxExpiryTime;
        this.maxExpiryTimeMs = yaml.maxExpiryTime ? parseDurationImport.then(v => v.default(yaml.maxExpiryTime!) ?? undefined) : undefined;
    }

    @hideKey()
    public get publicConfig(): Promise<GenericHookServiceConfig> {
        return (async () => ({
            userIdPrefix: this.userIdPrefix,
            allowJsTransformationFunctions: this.allowJsTransformationFunctions,
            waitForComplete: this.waitForComplete,
            maxExpiryTime: await this.maxExpiryTimeMs,
            requireExpiryTime: this.requireExpiryTime,
        }))();
    }

}
