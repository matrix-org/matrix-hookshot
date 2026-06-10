import { describe, it, expect } from "vitest";
import { BridgePermissions } from "../../src/libRs";

function genBridgePermissions(actor: string, service: string, level: string) {
  return new BridgePermissions([
    {
      actor,
      services: [
        {
          service,
          level,
        },
      ],
    },
  ]);
}

describe("Config/BridgePermissions", () => {
  describe("checkAction", () => {
    it("will return false for an empty actor set", () => {
      const bridgePermissions = new BridgePermissions([]);
      expect(
        bridgePermissions.checkAction("@foo:bar", "empty-service", "commands"),
      ).toBe(false);
    });

    it("will return false for an insufficent level", () => {
      const bridgePermissions = genBridgePermissions(
        "@foo:bar",
        "my-service",
        "login",
      );
      expect(
        bridgePermissions.checkAction(
          "@foo:bar",
          "my-service",
          "notifications",
        ),
      ).toBe(false);
    });

    it("will return false if the there are no matching services", () => {
      const bridgePermissions = genBridgePermissions(
        "@foo:bar",
        "my-service",
        "login",
      );
      expect(
        bridgePermissions.checkAction("@foo:bar", "other-service", "login"),
      ).toBe(false);
    });

    it("will return false if the target does not match", () => {
      const bridgePermissions = genBridgePermissions(
        "@foo:bar",
        "my-service",
        "login",
      );
      expect(
        bridgePermissions.checkAction("@foo:baz", "my-service", "login"),
      ).toBe(false);
    });

    it("will return true if there is a matching level and service", () => {
      const bridgePermissions = genBridgePermissions(
        "@foo:bar",
        "my-service",
        "login",
      );
      expect(
        bridgePermissions.checkAction("@foo:bar", "my-service", "login"),
      ).toBe(true);
    });

    it("will return true for a matching actor domain", () => {
      const bridgePermissions = genBridgePermissions(
        "bar",
        "my-service",
        "login",
      );
      expect(
        bridgePermissions.checkAction("@foo:bar", "my-service", "login"),
      ).toBe(true);
    });

    it("handles domain actors with ports", () => {
      const bridgePermissionNoPort = genBridgePermissions(
        "bar",
        "my-service",
        "login",
      );
      expect(
        bridgePermissionNoPort.checkAction(
          "@foo:bar:9999",
          "my-service",
          "login",
        ),
      ).toBe(false);
      expect(
        bridgePermissionNoPort.checkAction("@foo:bar", "my-service", "login"),
      ).toBe(true);
      const bridgePermissionWithPort = genBridgePermissions(
        "bar:9999",
        "my-service",
        "login",
      );
      expect(
        bridgePermissionWithPort.checkAction(
          "@foo:bar:9999",
          "my-service",
          "login",
        ),
      ).toBe(true);
      expect(
        bridgePermissionWithPort.checkAction(
          "@foo:bar:999",
          "my-service",
          "login",
        ),
      ).toBe(false);
      expect(
        bridgePermissionWithPort.checkAction(
          "@foo:bar:",
          "my-service",
          "login",
        ),
      ).toBe(false);
      expect(
        bridgePermissionWithPort.checkAction("@foo:bar", "my-service", "login"),
      ).toBe(false);
    });

    it("will return true for a wildcard actor", () => {
      const bridgePermissions = genBridgePermissions(
        "*",
        "my-service",
        "login",
      );
      expect(
        bridgePermissions.checkAction("@foo:bar", "my-service", "login"),
      ).toBe(true);
    });

    it("will return true for a wildcard service", () => {
      const bridgePermissions = genBridgePermissions("@foo:bar", "*", "login");
      expect(
        bridgePermissions.checkAction("@foo:bar", "my-service", "login"),
      ).toBe(true);
    });

    it("will return false if a user is not present in a room", () => {
      const bridgePermissions = genBridgePermissions(
        "!foo:bar",
        "my-service",
        "login",
      );
      expect(
        bridgePermissions.checkAction("@foo:bar", "my-service", "login"),
      ).toBe(false);
    });

    it("will return true if a user is present in a room", () => {
      const bridgePermissions = genBridgePermissions(
        "!foo:bar",
        "my-service",
        "login",
      );
      bridgePermissions.addMemberToCache("!foo:bar", "@foo:bar");
      expect(
        bridgePermissions.checkAction("@foo:bar", "my-service", "login"),
      ).toBe(true);
    });

    it("will fall through and return true for multiple permission sets", () => {
      const bridgePermissions = new BridgePermissions([
        {
          actor: "not-you",
          services: [
            {
              service: "my-service",
              level: "login",
            },
          ],
        },
        {
          actor: "or-you",
          services: [
            {
              service: "my-service",
              level: "login",
            },
          ],
        },
        {
          actor: "@foo:bar",
          services: [
            {
              service: "my-service",
              level: "commands",
            },
          ],
        },
      ]);
      expect(
        bridgePermissions.checkAction("@foo:bar", "my-service", "commands"),
      ).toBe(true);
      expect(
        bridgePermissions.checkAction("@foo:bar", "my-service", "login"),
      ).toBe(false);
    });

    it("handles legacy 'webhooks' config field", () => {
      const bridgePermissions = new BridgePermissions([
        {
          actor: "@foo:bar",
          services: [{ service: "webhooks", level: "manageConnections" }],
        },
      ]);
      expect(
        bridgePermissions.checkAction(
          "@foo:bar",
          "generic",
          "manageConnections",
        ),
      ).toBe(true);
    });
  });

  describe("permissionsCheckActionAny", () => {
    it("will return false for an empty actor set", () => {
      const bridgePermissions = new BridgePermissions([]);
      expect(bridgePermissions.checkActionAny("@foo:bar", "commands")).toBe(
        false,
      );
    });

    it(`will return false for a service with an insufficent level`, () => {
      const bridgePermissions = genBridgePermissions(
        "@foo:bar",
        "fake-service",
        "commands",
      );
      expect(bridgePermissions.checkActionAny("@foo:bar", "login")).toBe(false);
    });
    for (const actor of ["@foo:bar", "bar", "*"]) {
      it(`will return true for a service defintion of '${actor}' that has a sufficent level`, () => {
        const bridgePermissions = genBridgePermissions(
          "@foo:bar",
          "fake-service",
          "commands",
        );
        expect(bridgePermissions.checkActionAny("@foo:bar", "commands")).toBe(
          true,
        );
      });
    }
  });
});
