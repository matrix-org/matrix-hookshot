import { expect } from "chai";
import { BridgeConfigMessaging } from "../../../src/config/sections";

describe("config/sections/Messaging", () => {
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
