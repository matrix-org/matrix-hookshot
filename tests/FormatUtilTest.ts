import { FormatUtil } from "../src/FormatUtil";
import { expect } from "chai";
import { UserNotification } from "../src/UserNotificationWatcher";

const SIMPLE_ISSUE = {
    number: 123,
    state: "open",
    title: "A simple title",
    html_url: "https://github.com/evilcorp/lab/issues/123",
    repository_url: "https://api.github.com/repos/evilcorp/lab",
};

const SIMPLE_NOTIFICATION: UserNotification = {
    id: "",
    reason: "assign",
    unread: true,
    updated_at: 0,
    last_read_at: 0,
    url: "",
    subject: {
        title: "",
        url: "",
        latest_comment_url: "",
        type: "Issue",
        url_data: null,
        latest_comment_url_data: null,
    },
    repository: {

    } as any
};

describe("FormatUtilTest", () => {
    it("correctly formats a room name", () => {
        expect(FormatUtil.formatRoomName(SIMPLE_ISSUE)).to.equal(
            "evilcorp/lab#123: A simple title",
        );
    });
    it("correctly formats a room topic", () => {
        expect(FormatUtil.formatRoomTopic(SIMPLE_ISSUE)).to.equal(
            "A simple title | Status: open | https://github.com/evilcorp/lab/issues/123",
        );
    });
    it("correctly formats a notification", () => {
        expect(FormatUtil.formatNotification(SIMPLE_NOTIFICATION)).to.equal(
            "A simple title | Status: open | https://github.com/evilcorp/lab/issues/123",
        );
    });
});
