/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from "chai";
import { AdminRoom } from "../src/AdminRoom";
import { DefaultConfig } from "../src/config/Defaults";
import { ConnectionManager } from "../src/ConnectionManager";
import { NotifFilter } from "../src/NotificationFilters";
import { UserTokenStore } from "../src/tokens/UserTokenStore";
import { IntentMock } from "./utils/IntentMock";

const ROOM_ID = "!foo:bar";

function createAdminRoom(data: any = {admin_user: "@admin:bar"}): [AdminRoom, IntentMock] {
    const intent = IntentMock.create("@admin:bar");
    if (!data.admin_user) {
        data.admin_user = "@admin:bar";
    }
    return [new AdminRoom(ROOM_ID, data, NotifFilter.getDefaultContent(), intent, {} as UserTokenStore, DefaultConfig, {} as ConnectionManager), intent];
} 

describe("AdminRoom", () => {
    it("will present help text", async () => {
        const [adminRoom, intent] = createAdminRoom();
        await adminRoom.handleCommand("$foo:bar", "help");
        expect(intent.sentEvents).to.have.lengthOf(1);
        expect(intent.sentEvents[0]).to.deep.equal({
            roomId: ROOM_ID,
            content: AdminRoom.helpMessage(undefined, ["Github", "Gitlab", "Jira"]),
        });
    });
})
