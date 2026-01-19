import { GitHubRepoConnectionOptions } from "../../Connections";
import { GITHUB_CLOUD_URL, GithubInstance } from "../../github/GithubInstance";
import { configKey, hideKey } from "../Decorators";

export interface BridgeConfigGitHubYAML {
  enterpriseUrl?: string;
  auth: {
    id: number | string;
    privateKeyFile: string;
  };
  webhook: {
    secret: string;
  };
  oauth?: {
    client_id: string;
    client_secret: string;
    redirect_uri: string;
  };
  defaultOptions?: GitHubRepoConnectionOptions;
  userIdPrefix?: string;
}

export class BridgeConfigGitHub {
  @configKey("Authentication for the GitHub App.", false)
  readonly auth: {
    id: number | string;
    privateKeyFile: string;
  };
  @configKey("Webhook settings for the GitHub app.", false)
  readonly webhook: {
    secret: string;
  };
  @configKey("Settings for allowing users to sign in via OAuth.", true)
  readonly oauth?: {
    client_id: string;
    client_secret: string;
    redirect_uri: string;
  };
  @configKey("Default options for GitHub connections.", true)
  readonly defaultOptions?: GitHubRepoConnectionOptions;

  @configKey("Prefix used when creating ghost users for GitHub accounts.", true)
  readonly userIdPrefix: string;

  @configKey("URL for enterprise deployments. Does not include /api/v3", true)
  private enterpriseUrl?: string;

  @hideKey()
  public readonly baseUrl: URL;

  constructor(yaml: BridgeConfigGitHubYAML) {
    this.auth = yaml.auth;
    this.webhook = yaml.webhook;
    this.oauth = yaml.oauth;
    this.defaultOptions = yaml.defaultOptions;
    this.userIdPrefix = yaml.userIdPrefix || "_github_";
    this.baseUrl = yaml.enterpriseUrl
      ? new URL(yaml.enterpriseUrl)
      : GITHUB_CLOUD_URL;
  }

  public publicConfig(githubInstance?: GithubInstance) {
    return {
      userIdPrefix: this.userIdPrefix,
      newInstallationUrl: githubInstance?.newInstallationUrl?.toString(),
    };
  }
}
