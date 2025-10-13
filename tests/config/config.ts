import { BridgeConfig } from "../../src/config/Config";
import { DefaultConfigRoot } from "../../src/config/Defaults";
import { expect } from "chai";
import { ConnectionType } from "../../src/Connections/type";

const minimalConfig = {
  bridge: DefaultConfigRoot.bridge,
  logging: DefaultConfigRoot.logging,
  passFile: DefaultConfigRoot.passFile,
};

describe("Config/BridgeConfig", () => {
  describe("will handle the legacy queue.monolitihc option", () => {
    it("with no parameters", () => {
      const config = new BridgeConfig({
        ...DefaultConfigRoot,
        queue: {
          monolithic: true,
        },
      });
      expect(config.queue).to.be.undefined;
      expect(config.cache?.redisUri).to.equal("redis://localhost:6379");
    });

    it("with a host parameter", () => {
      const config = new BridgeConfig({
        ...DefaultConfigRoot,
        queue: {
          monolithic: true,
          host: "bark",
        },
      });
      expect(config.queue).to.be.undefined;
      expect(config.cache?.redisUri).to.equal("redis://bark:6379");
    });

    it("with a port parameter", () => {
      const config = new BridgeConfig({
        ...DefaultConfigRoot,
        queue: {
          monolithic: true,
          port: 6379,
        },
      });
      expect(config.queue).to.be.undefined;
      expect(config.cache?.redisUri).to.equal("redis://localhost:6379");
    });

    it("with a host and port parameter", () => {
      const config = new BridgeConfig({
        ...DefaultConfigRoot,
        queue: {
          monolithic: true,
          host: "bark",
          port: 6379,
        },
      });
      expect(config.queue).to.be.undefined;
      expect(config.cache?.redisUri).to.equal("redis://bark:6379");
    });

    it("with monolithic disabled", () => {
      const config = new BridgeConfig({
        ...DefaultConfigRoot,
        encryption: undefined,
        queue: {
          monolithic: false,
        },
      });
      expect(config.queue).to.deep.equal({
        monolithic: false,
      });
      expect(config.cache?.redisUri).to.equal("redis://localhost:6379");
    });
  });

  describe("will handle the queue option", () => {
    it("with redisUri", () => {
      const config = new BridgeConfig({
        ...DefaultConfigRoot,
        encryption: undefined,
        queue: {
          redisUri: "redis://localhost:6379",
        },
        cache: undefined,
      });
      expect(config.queue).to.deep.equal({
        redisUri: "redis://localhost:6379",
      });
      expect(config.cache).to.be.undefined;
    });
  });

  describe("will handle the cache option", () => {
    it("with redisUri", () => {
      const config = new BridgeConfig({
        ...DefaultConfigRoot,
        cache: {
          redisUri: "redis://localhost:6379",
        },
        queue: undefined,
      });
      expect(config.cache).to.deep.equal({
        redisUri: "redis://localhost:6379",
      });
      expect(config.queue).to.be.undefined;
    });
  });

  describe("publicConfig", () => {

    it("for ChallengeHound", async () => {
      const config = new BridgeConfig({
        ...minimalConfig,
        challengeHound: { token: "a-token " },
      });
      expect(
        await config.getPublicConfigForService(ConnectionType.ChallengeHound),
      ).to.deep.equal({});
    });

    it("for Feeds", async () => {
      const config = new BridgeConfig({
        ...minimalConfig,
        feeds: { enabled: true, pollIntervalSeconds: 150 },
      });
      expect(
        await config.getPublicConfigForService(ConnectionType.Feeds),
      ).to.deep.equal({ pollIntervalSeconds: 150 });
    });

    it("for Figma", async () => {
      const config = new BridgeConfig({
        ...minimalConfig,
        figma: {
          publicUrl: "https://example.org",
          instances: {
            "a-team": { teamId: "123", accessToken: "abc", passcode: "def" },
          },
        },
      });
      expect(
        await config.getPublicConfigForService(ConnectionType.Figma),
      ).to.deep.equal({});
    });

    it("for Generic (inbound)", async () => {
      const config = new BridgeConfig({
        ...minimalConfig,
        generic: {
          enabled: true,
          urlPrefix: "https://example.org",
          maxExpiryTime: "15s",
          requireExpiryTime: true,
          allowJsTransformationFunctions: true,
        },
      });
      expect(
        await config.getPublicConfigForService(ConnectionType.Generic),
      ).to.deep.equal({
        requireExpiryTime: true,
        maxExpiryTime: 15000,
        allowJsTransformationFunctions: true,
        userIdPrefix: undefined,
        waitForComplete: undefined,
      });
    });

    it("for Generic (outbound)", async () => {
      const config = new BridgeConfig({
        ...minimalConfig,
        generic: {
          enabled: false,
          outbound: true,
          urlPrefix: "https://example.org",
          maxExpiryTime: "15s",
          requireExpiryTime: true,
          allowJsTransformationFunctions: true,
        },
      });
      expect(
        await config.getPublicConfigForService(ConnectionType.GenericOutbound),
      ).to.deep.equal({});
    });

    it("for Github", async () => {
      const config = new BridgeConfig({
        ...minimalConfig,
        github: {
          auth: {
            id: 123,
            privateKeyFile: "github-key.pem",
          },
          webhook: {
            secret: "secrettoken",
          },
          userIdPrefix: "_foobar_",
        },
      });
      expect(
        await config.getPublicConfigForService(ConnectionType.Github),
      ).to.deep.equal({
        userIdPrefix: "_foobar_",
        newInstallationUrl: undefined,
      });
    });

    it("for Gitlab", async () => {
      const config = new BridgeConfig({
        ...minimalConfig,
        gitlab: {
          webhook: {
            secret: "foo-bar",
          },
          instances: {
            foobar: {
              url: "https://example.org",
            },
          },
          userIdPrefix: "_foobar_",
        },
      });
      expect(
        await config.getPublicConfigForService(ConnectionType.Gitlab),
      ).to.deep.equal({
        userIdPrefix: "_foobar_",
      });
    });

    it("for Jira", async () => {
      const config = new BridgeConfig({
        ...minimalConfig,
        jira: {
          webhook: {
            secret: "foo!",
          },
        },
      });
      expect(
        await config.getPublicConfigForService(ConnectionType.Jira),
      ).to.deep.equal({});
    });

    it("for OpenProject", async () => {
      const config = new BridgeConfig({
        ...minimalConfig,
        openProject: {
          baseUrl: "https://example.org",
          webhook: {
            secret: "foo!",
          },
        },
      });
      expect(
        await config.getPublicConfigForService(ConnectionType.OpenProject),
      ).to.deep.equal({ baseUrl: "https://example.org/" });
    });
  });
});
