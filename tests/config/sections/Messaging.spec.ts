import { describe, it, expect } from "vitest";
import { BridgeConfigMessaging } from "../../../src/config/sections";

describe("config/sections/Messaging", () => {
  it("disables client integration by default and accepts explicit booleans", () => {
    expect(new BridgeConfigMessaging().allowClientIntegration).toBe(false);
    expect(
      new BridgeConfigMessaging({ allowClientIntegration: true })
        .allowClientIntegration,
    ).toBe(true);
    expect(
      new BridgeConfigMessaging({ allowClientIntegration: false })
        .allowClientIntegration,
    ).toBe(false);
  });

  it("rejects a non-boolean client integration setting", () => {
    expect(
      () =>
        new BridgeConfigMessaging({
          allowClientIntegration: "true" as unknown as boolean,
        }),
    ).toThrow("messaging.allowClientIntegration");
  });
  it("will not add hints to messages for allowUrlPreviews=true", () => {
    expect(
      new BridgeConfigMessaging({
        allowUrlPreviews: true,
      }).formatMatrixMessage({}),
    ).to.deep.equal({});
  });

  it("will add hints to messages for allowUrlPreviews=false", () => {
    expect(
      new BridgeConfigMessaging({
        allowUrlPreviews: false,
      }).formatMatrixMessage({}),
    ).to.deep.equal({ "com.beeper.linkpreviews": [] });
  });

  it("will not add hints to messages when overriden by parameters ", () => {
    expect(
      new BridgeConfigMessaging({
        allowUrlPreviews: false,
      }).formatMatrixMessage({}, { allowUrlPreviews: true }),
    ).to.deep.equal({});
  });

  it("will add hints to messages when overriden by parameters ", () => {
    expect(
      new BridgeConfigMessaging({
        allowUrlPreviews: false,
      }).formatMatrixMessage({}, { allowUrlPreviews: false }),
    ).to.deep.equal({
      "com.beeper.linkpreviews": [],
    });
  });
});
