import { ConfigError } from "../../Errors";
import { hideKey } from "../Decorators";

function makePrefixedUrl(urlString: string): URL {
  return new URL(urlString.endsWith("/") ? urlString : urlString + "/");
}

export interface BridgeWidgetConfigYAML {
  publicUrl: string;
  /**
   * @deprecated Prefer using listener config.
   */
  port?: number;
  addToAdminRooms?: boolean;
  roomSetupWidget?: {
    addOnInvite?: boolean;
  };
  disallowedIpRanges?: string[];
  allowedIpRanges?: string[];
  branding?: {
    widgetTitle: string;
  };
  openIdOverrides?: Record<string, string>;
}

export class BridgeWidgetConfig {
  public readonly addToAdminRooms: boolean;

  @hideKey()
  public readonly parsedPublicUrl: URL;
  public readonly publicUrl: () => string;

  public readonly roomSetupWidget?: {
    addOnInvite?: boolean;
  };
  public readonly disallowedIpRanges?: string[];
  public readonly allowedIpRanges?: string[];
  public readonly branding: {
    widgetTitle: string;
  };

  @hideKey()
  public readonly openIdOverrides?: Record<string, URL>;
  constructor(yaml: BridgeWidgetConfigYAML) {
    this.addToAdminRooms = yaml.addToAdminRooms || false;
    this.disallowedIpRanges = yaml.disallowedIpRanges;
    this.allowedIpRanges = yaml.allowedIpRanges;
    this.roomSetupWidget = yaml.roomSetupWidget;
    if (
      yaml.disallowedIpRanges !== undefined &&
      (!Array.isArray(yaml.disallowedIpRanges) ||
        !yaml.disallowedIpRanges.every((s) => typeof s === "string"))
    ) {
      throw new ConfigError(
        "widgets.disallowedIpRanges",
        "must be a string array",
      );
    }
    if (
      yaml.allowedIpRanges !== undefined &&
      (!Array.isArray(yaml.allowedIpRanges) ||
        !yaml.allowedIpRanges.every((s) => typeof s === "string"))
    ) {
      throw new ConfigError(
        "widgets.allowedIpRanges",
        "must be a string array",
      );
    }
    try {
      this.parsedPublicUrl = makePrefixedUrl(yaml.publicUrl);
      this.publicUrl = () => {
        return this.parsedPublicUrl.href;
      };
    } catch {
      throw new ConfigError(
        "widgets.publicUrl",
        "is not defined or not a valid URL",
      );
    }
    this.branding = yaml.branding || {
      widgetTitle: "Hookshot Configuration",
    };
    if (yaml.openIdOverrides) {
      this.openIdOverrides = {};
      for (const [serverName, urlStr] of Object.entries(yaml.openIdOverrides)) {
        this.openIdOverrides[serverName] = new URL(urlStr);
      }
    }
  }
}
