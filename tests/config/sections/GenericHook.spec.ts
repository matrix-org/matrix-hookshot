import { expect } from "chai";
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
      ).to.throw();
    });

    it("throws with a NaN integer", () => {
      expect(
        () =>
          new BridgeConfigGenericWebhooks({
            enabled: true,
            urlPrefix: "https://example.org/foo",
            payloadSizeLimit: NaN,
          }),
      ).to.throw();
    });
    it("throws with a float", () => {
      expect(
        () =>
          new BridgeConfigGenericWebhooks({
            enabled: true,
            urlPrefix: "https://example.org/foo",
            payloadSizeLimit: 50.5,
          }),
      ).to.throw();
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
});
