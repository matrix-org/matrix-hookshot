import { describe, it, expect } from "vitest";
import { BridgeConfigGenericWebhooks } from "../../../src/config/sections/GenericHooks";

describe("config/sections/GenericHooks", () => {
  describe("payloadSizeLimit", () => {
    it("with an integer parameter", () => {
      new BridgeConfigGenericWebhooks({
        enabled: true,
        urlPrefix: "https://example.org/foo",
        payloadSizeLimit: 100,
      });
    });

    it("throws with a negative integer", () => {
      expect(
        () =>
          new BridgeConfigGenericWebhooks({
            enabled: true,
            urlPrefix: "https://example.org/foo",
            payloadSizeLimit: -1,
          }),
      ).toThrow();
    });

    it("throws with a NaN integer", () => {
      expect(
        () =>
          new BridgeConfigGenericWebhooks({
            enabled: true,
            urlPrefix: "https://example.org/foo",
            payloadSizeLimit: NaN,
          }),
      ).toThrow();
    });

    it("throws with a float", () => {
      expect(
        () =>
          new BridgeConfigGenericWebhooks({
            enabled: true,
            urlPrefix: "https://example.org/foo",
            payloadSizeLimit: 50.5,
          }),
      ).toThrow();
    });

    for (const payloadSizeLimit of ["1mb", "1kb", "1gb"]) {
      it(`with an string format parameter ${payloadSizeLimit}`, () => {
        new BridgeConfigGenericWebhooks({
          enabled: true,
          urlPrefix: "https://example.org/foo",
          payloadSizeLimit,
        });
      });
    }
  });

  describe("displaynameSuffix", () => {
    it("defaults to ' (Webhook)' when unset", () => {
      const config = new BridgeConfigGenericWebhooks({
        enabled: true,
        urlPrefix: "https://example.org/foo",
      });
      expect(config.displaynameSuffix).toBe(" (Webhook)");
    });

    it("with a custom value", () => {
      const config = new BridgeConfigGenericWebhooks({
        enabled: true,
        urlPrefix: "https://example.org/foo",
        displaynameSuffix: " [alerts]",
      });
      expect(config.displaynameSuffix).toBe(" [alerts]");
    });

    it("with an empty value", () => {
      const config = new BridgeConfigGenericWebhooks({
        enabled: true,
        urlPrefix: "https://example.org/foo",
        displaynameSuffix: "",
      });
      expect(config.displaynameSuffix).toBe("");
    });
  });
});
