import { expect } from "chai";
import { AppserviceMock } from "./utils/AppserviceMock";
import { Bridge } from "../src/Bridge";
import { UserTokenStore } from "../src/tokens/UserTokenStore";
import { ListenerService } from "../src/ListenerService";
import { IBridgeStorageProvider } from "../src/Stores/StorageProvider";
import { BotUsersManager } from "../src/Managers/BotUsersManager";
import { MatrixClient } from "matrix-bot-sdk";

describe("Bridge", () => {
    let bridge: Bridge;
    let appservice: AppserviceMock;
    let tokenStore: UserTokenStore;
    let listener: ListenerService;
    let storage: IBridgeStorageProvider;
    let botUsersManager: BotUsersManager;

    beforeEach(() => {
        appservice = AppserviceMock.create();
        tokenStore = new UserTokenStore();
        listener = new ListenerService();
        storage = {} as IBridgeStorageProvider;
        botUsersManager = new BotUsersManager(appservice, tokenStore, storage);
        bridge = new Bridge(
            { queue: {} } as any,
            tokenStore,
            listener,
            appservice,
            storage,
            botUsersManager
        );
    });

    describe("handleRoomUpgrade", () => {
        it("should copy 'hookshot.*' events from old room to new room", async () => {
            const oldRoomId = "!oldRoom:example.com";
            const newRoomId = "!newRoom:example.com";

            const oldRoomState = [
                { type: "hookshot.event1", state_key: "", content: { key: "value1" } },
                { type: "hookshot.event2", state_key: "", content: { key: "value2" } },
                { type: "m.room.name", state_key: "", content: { name: "Old Room" } },
            ];

            const botClient = appservice.botClient as unknown as MatrixClient;
            botClient.getRoomState = async (roomId: string) => {
                if (roomId === oldRoomId) {
                    return oldRoomState;
                }
                return [];
            };

            botClient.sendStateEvent = async (roomId: string, eventType: string, stateKey: string, content: any) => {
                expect(roomId).to.equal(newRoomId);
                expect(eventType).to.match(/^hookshot\./);
                expect(content).to.have.property("key");
            };

            await bridge.handleRoomUpgrade(oldRoomId, newRoomId);
        });
    });
});
