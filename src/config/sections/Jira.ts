import assert from "node:assert";
import { configKey, hideKey } from "../Decorators";

export interface BridgeConfigJiraCloudOAuth {
  client_id: string;
  client_secret: string;
  redirect_uri: string;
}

export interface BridgeConfigJiraOnPremOAuth {
  consumerKey: string;
  privateKey: string;
  redirect_uri: string;
}

export interface BridgeConfigJiraYAML {
  webhook: {
    secret: string;
  };
  url?: string;
  oauth?: BridgeConfigJiraCloudOAuth | BridgeConfigJiraOnPremOAuth;
}
export class BridgeConfigJira implements BridgeConfigJiraYAML {
  static CLOUD_INSTANCE_NAME = "api.atlassian.com";

  @configKey("Webhook settings for JIRA")
  readonly webhook: {
    secret: string;
  };

  // To hide the undefined for now
  @hideKey()
  @configKey(
    "URL for the instance if using on prem. Ignore if targetting cloud (atlassian.net)",
    true,
  )
  readonly url?: string;
  @configKey(
    "OAuth settings for connecting users to JIRA. See documentation for more information",
    true,
  )
  readonly oauth?: BridgeConfigJiraCloudOAuth | BridgeConfigJiraOnPremOAuth;

  @hideKey()
  readonly instanceUrl?: URL;

  @hideKey()
  readonly instanceName: string;

  constructor(yaml: BridgeConfigJiraYAML) {
    assert.ok(yaml.webhook);
    assert.ok(yaml.webhook.secret);
    this.webhook = yaml.webhook;
    this.url = yaml.url;
    this.instanceUrl = yaml.url !== undefined ? new URL(yaml.url) : undefined;
    this.instanceName =
      this.instanceUrl?.host || BridgeConfigJira.CLOUD_INSTANCE_NAME;
    if (!yaml.oauth) {
      return;
    }
    let oauth: BridgeConfigJiraCloudOAuth | BridgeConfigJiraOnPremOAuth;

    assert.ok(yaml.oauth.redirect_uri);
    // Validate oauth settings
    if (this.url) {
      // On-prem
      oauth = yaml.oauth as BridgeConfigJiraOnPremOAuth;
      assert.ok(oauth.consumerKey);
      assert.ok(oauth.privateKey);
    } else {
      // Cloud
      oauth = yaml.oauth as BridgeConfigJiraCloudOAuth;
      assert.ok(oauth.client_id);
      assert.ok(oauth.client_secret);
    }
    this.oauth = oauth;
  }
}
