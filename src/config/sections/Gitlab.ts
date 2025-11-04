import { configKey, hideKey } from "../Decorators";

export interface GitLabInstance {
  url: string;
}

export interface BridgeConfigGitLabYAML {
  webhook: {
    publicUrl?: string;
    secret: string;
  };
  instances: { [name: string]: GitLabInstance };
  userIdPrefix?: string;
  commentDebounceMs?: number;
}

export class BridgeConfigGitLab {
  readonly instances: { [name: string]: GitLabInstance };
  readonly webhook: {
    publicUrl?: string;
    secret: string;
  };

  @configKey("Prefix used when creating ghost users for GitLab accounts.", true)
  readonly userIdPrefix: string;

  @configKey(
    "Aggregate comments by waiting this many miliseconds before posting them to Matrix. Defaults to 5000 (5 seconds)",
    true,
  )
  readonly commentDebounceMs: number;

  constructor(yaml: BridgeConfigGitLabYAML) {
    this.instances = yaml.instances;
    this.webhook = yaml.webhook;
    this.userIdPrefix = yaml.userIdPrefix || "_gitlab_";

    for (const name in this.instances) {
      const url = this.instances[name].url;
      if (url.endsWith("/")) {
        this.instances[name].url = url.slice(0, -1);
      }
    }

    if (yaml.commentDebounceMs === undefined) {
      this.commentDebounceMs = 5000;
    } else {
      this.commentDebounceMs = yaml.commentDebounceMs;
    }
  }

  @hideKey()
  public get publicConfig() {
    return {
      userIdPrefix: this.userIdPrefix,
    };
  }

  public getInstanceByProjectUrl(
    url: string,
  ): { name: string; instance: GitLabInstance } | null {
    for (const [name, instance] of Object.entries(this.instances)) {
      if (url.startsWith(instance.url)) {
        return { name, instance };
      }
    }
    return null;
  }
}
