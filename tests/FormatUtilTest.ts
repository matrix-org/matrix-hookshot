import { FormatUtil } from "../src/FormatUtil";
import { expect } from "chai";

const SIMPLE_ISSUE = {
    number: 123,
    state: "open",
    title: "A simple title",
    html_url: "https://github.com/evilcorp/lab/issues/123",
    repository_url: "https://api.github.com/repos/evilcorp/lab",
};

describe("FormatUtilTest", () => {
    it("correctly formats a room name", () => {
        expect(FormatUtil.formatRoomName(SIMPLE_ISSUE)).to.equal(
            "evilcorp/lab#123: A simple title",
        );
    });
    it("correctly formats a room topic", () => {
        expect(FormatUtil.formatRoomTopic(SIMPLE_ISSUE)).to.equal(
            "Status: open | https://github.com/evilcorp/lab/issues/123",
        );
    });
});
