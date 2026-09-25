import { E2ESetupTestTimeout, E2ETestEnv } from "./util/e2e-test";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

describe("Element Web modules", () => {
  let testEnv: E2ETestEnv;
  let moduleUrl: URL;

  beforeAll(async () => {
    const modulePort = 9500 + E2ETestEnv.workerId;
    moduleUrl = new URL(
      `http://localhost:${modulePort}/modules/v2/static/openproject.js`,
    );
    testEnv = await E2ETestEnv.createTestEnv({
      matrixLocalparts: ["user"],
      config: {
        listeners: [
          {
            port: modulePort,
            bindAddress: "0.0.0.0",
            resources: ["webhooks", "modules"],
          },
        ],
      },
    });
    await testEnv.setUp();
  }, E2ESetupTestTimeout);

  afterAll(() => {
    return testEnv?.tearDown();
  });

  test("should serve the OpenProject Element Web module", async () => {
    const response = await fetch(moduleUrl);

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("content-type")).toContain(
      "application/javascript",
    );
    expect(await response.text()).toContain('moduleApiVersion = "^2.0.0"');
  });
});
