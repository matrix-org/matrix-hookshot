import { E2ESetupTestTimeout, E2ETestEnv } from "./util/e2e-test";
import { describe, test, beforeAll, afterAll, expect } from "vitest";
import { getBridgeApi } from "./util/bridge-api";

describe("Widgets", () => {
  let testEnv: E2ETestEnv;

  beforeAll(async () => {
    const webhooksPort = 9500 + E2ETestEnv.workerId;
    testEnv = await E2ETestEnv.createTestEnv({
      matrixLocalparts: ["user"],
      config: {
        widgets: {
          publicUrl: `http://localhost:${webhooksPort}`,
        },
        listeners: [
          {
            port: webhooksPort,
            bindAddress: "0.0.0.0",
            // Bind to the SAME listener to ensure we don't have conflicts.
            resources: ["webhooks", "widgets"],
          },
        ],
      },
    });
    await testEnv.setUp();
  }, E2ESetupTestTimeout);

  afterAll(() => {
    return testEnv?.tearDown();
  });

  test("should be able to authenticate with the widget API", async () => {
    const user = testEnv.getUser("user");
    const bridgeApi = await getBridgeApi(
      testEnv.opts.config?.widgets?.publicUrl!,
      user,
    );
    expect(await bridgeApi.verify()).toEqual({
      type: "widget",
      userId: "@user:hookshot",
    });
  });
});
