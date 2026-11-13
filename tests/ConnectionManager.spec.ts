import { describe, test, expect } from "vitest";
import { CommentProcessor } from "../src/CommentProcessor";
import { ConnectionManager } from "../src/ConnectionManager";
import { GenericHookConnection } from "../src/Connections";
import { BridgeConfig } from "../src/config/Config";
import { DefaultConfigRoot } from "../src/config/Defaults";
import BotUsersManager from "../src/managers/BotUsersManager";
import { MessageSenderClient } from "../src/MatrixSender";
import { IBridgeStorageProvider } from "../src/stores/StorageProvider";
import { UserTokenStore } from "../src/tokens/UserTokenStore";
import { AppserviceMock } from "./utils/AppserviceMock";

const ROOM_A = "!a:example.com";
const ROOM_B = "!b:example.com";
const DEFAULT_BOT = "@bot:example.com";
const GENERIC_BOT = "@webhooks:example.com";
const FEEDS_BOT = "@feeds:example.com";

function createConnectionManager(
  serviceBots: ("generic" | "feeds")[],
  joinedRooms: { botUserId: string; roomId: string }[],
) {
  const config = new BridgeConfig({
    ...DefaultConfigRoot,
    serviceBots: serviceBots.map((service) => ({
      localpart: service === "generic" ? "webhooks" : "feeds",
      prefix: `!${service}`,
      service,
    })),
    connections: [ROOM_A, ROOM_B].map((roomId) => ({
      connectionType: GenericHookConnection.CanonicalEventType,
      stateKey: `hook-${roomId}`,
      roomId,
      state: { name: "My hook" },
    })),
  });
  const as = AppserviceMock.create();
  const botUsersManager = new BotUsersManager(config, as);
  for (const { botUserId, roomId } of joinedRooms) {
    const botUser = botUsersManager.getBotUser(botUserId);
    if (!botUser) {
      throw Error(`Bot user ${botUserId} is not configured`);
    }
    botUsersManager.onRoomJoin(botUser, roomId);
  }
  return new ConnectionManager(
    as,
    config,
    {} as UserTokenStore,
    {} as CommentProcessor,
    {} as MessageSenderClient,
    {} as IBridgeStorageProvider,
    botUsersManager,
  );
}

describe("ConnectionManager", () => {
  test.each<{
    name: string;
    serviceBots: ("generic" | "feeds")[];
    joinedRooms: { botUserId: string; roomId: string }[];
    roomId?: string;
    expected: { index: number; botUserId: string }[];
  }>([
    {
      name: "no bot has joined any room",
      serviceBots: [],
      joinedRooms: [],
      expected: [
        { index: 0, botUserId: DEFAULT_BOT },
        { index: 1, botUserId: DEFAULT_BOT },
      ],
    },
    {
      name: "the bot has joined one room",
      serviceBots: [],
      joinedRooms: [{ botUserId: DEFAULT_BOT, roomId: ROOM_A }],
      expected: [{ index: 1, botUserId: DEFAULT_BOT }],
    },
    {
      name: "only a bot for another service has joined a room",
      serviceBots: ["feeds"],
      joinedRooms: [{ botUserId: FEEDS_BOT, roomId: ROOM_A }],
      expected: [
        { index: 0, botUserId: DEFAULT_BOT },
        { index: 1, botUserId: DEFAULT_BOT },
      ],
    },
    {
      name: "a service bot handles generic hooks",
      serviceBots: ["generic"],
      joinedRooms: [{ botUserId: GENERIC_BOT, roomId: ROOM_A }],
      expected: [{ index: 1, botUserId: GENERIC_BOT }],
    },
    {
      name: "checking a single room the bot has joined",
      serviceBots: [],
      joinedRooms: [{ botUserId: DEFAULT_BOT, roomId: ROOM_A }],
      roomId: ROOM_A,
      expected: [],
    },
    {
      name: "checking a single room the bot has not joined",
      serviceBots: [],
      joinedRooms: [{ botUserId: DEFAULT_BOT, roomId: ROOM_A }],
      roomId: ROOM_B,
      expected: [{ index: 1, botUserId: DEFAULT_BOT }],
    },
  ])(
    "finds inactive static connections when $name",
    ({ serviceBots, joinedRooms, roomId, expected }) => {
      const connectionManager = createConnectionManager(
        serviceBots,
        joinedRooms,
      );
      expect(
        connectionManager
          .getInactiveStaticConnections(roomId)
          .map(({ index, botUserId }) => ({ index, botUserId })),
      ).toEqual(expected);
    },
  );
});
