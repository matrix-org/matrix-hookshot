import { describe, expect, it } from "vitest";
import type { Appservice } from "matrix-bot-sdk";

import BotUsersManager from "../src/managers/BotUsersManager";
import type { BridgeConfig } from "../src/config/Config";

function createAppservice(): Appservice {
  return {
    botUserId: "@hookshot:example.org",
    getUserId: (localpart: string) => `@${localpart}:example.org`,
    getIntentForUserId: () => undefined,
  } as unknown as Appservice;
}

function createConfig(serviceBots?: BridgeConfig["serviceBots"]): BridgeConfig {
  return {
    enabledServices: ["openproject"],
    serviceBots,
  } as unknown as BridgeConfig;
}

describe("BotUsersManager capability bot selection", () => {
  it("selects the default bot when no dedicated bot is configured", () => {
    const manager = new BotUsersManager(createConfig(), createAppservice());

    expect(manager.getIntegrationBotForService("openproject")?.userId).toBe(
      "@hookshot:example.org",
    );
  });

  it("selects a dedicated bot over the default bot", () => {
    const manager = new BotUsersManager(
      createConfig([
        {
          localpart: "hookshot_openproject",
          prefix: "!openproject",
          service: "openproject",
        },
      ]),
      createAppservice(),
    );

    expect(manager.getIntegrationBotForService("openproject")?.userId).toBe(
      "@hookshot_openproject:example.org",
    );
  });

  it("separates deployment selection from room membership", () => {
    const manager = new BotUsersManager(createConfig(), createAppservice());
    manager.onRoomJoin(
      manager.getIntegrationBotForService("openproject")!,
      "!room:example.org",
    );

    expect(
      manager.isBotUserInRoom("!room:example.org", "@hookshot:example.org"),
    ).toBe(true);
    expect(
      manager.isBotUserInRoom(
        "!other-room:example.org",
        "@hookshot:example.org",
      ),
    ).toBe(false);
  });
});
