import { expect } from "chai";
import { AdminRoomCommandHandler, Category } from "../src/AdminRoomCommandHandler";
import { IntentMock } from "./utils/IntentMock";

describe("AdminRoomCommandHandler", () => {
    it("should copy state from another room", async () => {
        const botIntent = IntentMock.create("@bot:example.com");
        const handler = new AdminRoomCommandHandler(botIntent, "!targetRoom:example.com", {} as any, {} as any, { admin_user: "@admin:example.com" });

        const sourceRoomId = "!sourceRoom:example.com";
        const stateEvents = [
            { type: "hookshot.event1", state_key: "", content: { key: "value1" } },
            { type: "hookshot.event2", state_key: "", content: { key: "value2" } },
            { type: "m.room.name", state_key: "", content: { name: "Source Room" } },
        ];

        botIntent.underlyingClient.getRoomState = async () => stateEvents;

        await handler.copyStateFromRoom(sourceRoomId);

        expect(botIntent.sentEvents).to.have.lengthOf(2);
        expect(botIntent.sentEvents[0].content).to.deep.equal({ key: "value1" });
        expect(botIntent.sentEvents[1].content).to.deep.equal({ key: "value2" });
    });

    it("should handle copy_state command", async () => {
        const botIntent = IntentMock.create("@bot:example.com");
        const handler = new AdminRoomCommandHandler(botIntent, "!targetRoom:example.com", {} as any, {} as any, { admin_user: "@admin:example.com" });

        const sourceRoomId = "!sourceRoom:example.com";
        const stateEvents = [
            { type: "hookshot.event1", state_key: "", content: { key: "value1" } },
            { type: "hookshot.event2", state_key: "", content: { key: "value2" } },
            { type: "m.room.name", state_key: "", content: { name: "Source Room" } },
        ];

        botIntent.underlyingClient.getRoomState = async () => stateEvents;

        await handler.copyStateCommand(sourceRoomId);

        expect(botIntent.sentEvents).to.have.lengthOf(2);
        expect(botIntent.sentEvents[0].content).to.deep.equal({ key: "value1" });
        expect(botIntent.sentEvents[1].content).to.deep.equal({ key: "value2" });
    });
});
