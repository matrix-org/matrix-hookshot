import { ConfigError } from "../../Errors";
import { configKey } from "../Decorators";

export interface BridgeConfigMessagingYAML {
  allowClientIntegration?: boolean;
  allowUrlPreviews?: boolean;
}

interface MessageHints {
  ["com.beeper.linkpreviews"]?: [];
}

export class BridgeConfigMessaging {
  @configKey(
    "Allow clients to interact directly with service bot integrations. Off by default",
    true,
  )
  public readonly allowClientIntegration: boolean;

  @configKey(
    "Allow clients to generate their own URL previews from Hookshot messages. On by default",
    true,
  )
  public readonly allowUrlPreviews: boolean;

  constructor(config?: BridgeConfigMessagingYAML) {
    if (config?.allowClientIntegration === undefined) {
      this.allowClientIntegration = false;
    } else if (typeof config.allowClientIntegration === "boolean") {
      this.allowClientIntegration = config.allowClientIntegration;
    } else {
      throw new ConfigError(
        "messaging.allowClientIntegration",
        "must be a boolean.",
      );
    }
    if (config?.allowUrlPreviews === undefined) {
      this.allowUrlPreviews = true;
    } else if (typeof config.allowUrlPreviews === "boolean") {
      this.allowUrlPreviews = config.allowUrlPreviews;
    } else {
      throw new ConfigError("messaging.allowUrlPreviews", "must be a boolean.");
    }
  }

  /**
   * Format a Matrix message, taking care to apply configuration defaults.
   * @param eventContent
   * @param messageConfig
   * @returns
   */
  public formatMatrixMessage<T extends Record<string, unknown>>(
    eventContent: T,
    messageConfig: BridgeConfigMessagingYAML = {},
  ): MessageHints & T {
    const hints: MessageHints = {};
    if (!(messageConfig.allowUrlPreviews ?? this.allowUrlPreviews)) {
      hints["com.beeper.linkpreviews"] = [];
    }

    return {
      ...eventContent,
      ...hints,
    };
  }
}
