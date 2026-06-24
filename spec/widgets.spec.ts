import { test as baseTest } from "./util/fixtures";
import { describe, expect } from "vitest";

const test = baseTest.override("enableWidgets", true);

describe("Widgets", () => {
  test("should be able to authenticate with the widget API", async ({
    testEnv,
    user,
    bridgeApi,
  }) => {
    expect(await bridgeApi.verify()).toEqual({
      type: "widget",
      userId: "@user:hookshot",
    });
  });
});
