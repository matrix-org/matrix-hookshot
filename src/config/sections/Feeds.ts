import assert from "node:assert";
import { hideKey } from "../Decorators";

export interface BridgeConfigFeedsYAML {
  enabled: boolean;
  pollIntervalSeconds?: number;
  pollConcurrency?: number;
  pollTimeoutSeconds?: number;
}

export class BridgeConfigFeeds {
  public enabled: boolean;
  public pollIntervalSeconds: number;
  public pollTimeoutSeconds: number;
  public pollConcurrency: number;

  constructor(yaml: BridgeConfigFeedsYAML) {
    this.enabled = yaml.enabled;
    this.pollConcurrency = yaml.pollConcurrency ?? 4;
    this.pollIntervalSeconds = yaml.pollIntervalSeconds ?? 600;
    assert.strictEqual(typeof this.pollIntervalSeconds, "number");
    this.pollTimeoutSeconds = yaml.pollTimeoutSeconds ?? 30;
    assert.strictEqual(typeof this.pollTimeoutSeconds, "number");
  }

  @hideKey()
  public get publicConfig() {
    return {
      pollIntervalSeconds: this.pollIntervalSeconds,
    };
  }
}
