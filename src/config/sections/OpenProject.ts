import assert from "assert";
import { hideKey } from "../Decorators";
import { OpenProjectServiceConfig } from "../../Connections/OpenProjectConnection";

export interface BridgeOpenProjectOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface BridgeOpenProjectConfigYAML {
  webhook: {
    secret: string;
  };
  baseUrl: string;
  oauth?: BridgeOpenProjectOAuthConfig;
}

function makePrefixedUrl(urlString?: string): URL {
  return new URL(urlString?.endsWith("/") ? urlString : urlString + "/");
}
export class BridgeOpenProjectConfig {
  /**
   * @ignore For config generator only.
   */
  public readonly baseUrl;

  /**
   * @ignore For config generator only.
   */
  public readonly webhook: { secret: string };

  @hideKey()
  baseURL: URL;
  oauth?: BridgeOpenProjectOAuthConfig;

  constructor(config: BridgeOpenProjectConfigYAML) {
    assert(config.webhook?.secret);
    this.webhook = config.webhook;
    this.baseURL = makePrefixedUrl(config.baseUrl);
    this.baseUrl = config.baseUrl;
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
      baseUrl: this.baseURL.origin + this.baseURL.pathname,
    };
  }
}
