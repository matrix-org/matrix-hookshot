import { FormatUtil } from "../src/FormatUtil";
import { expect } from "chai";

const SIMPLE_ISSUE = {
    id: 123,
    number: 123,
    state: "open",
    title: "A simple title",
    full_name: "evilcorp/lab",
    url: "https://github.com/evilcorp/lab/issues/123",
    html_url: "https://github.com/evilcorp/lab/issues/123",
    repository_url: "https://api.github.com/repos/evilcorp/lab",
};

const SIMPLE_REPO = {
    id: 123,
    description: "A simple description",
    full_name: "evilcorp/lab",
    html_url: "https://github.com/evilcorp/lab/issues/123",
};


describe("FormatUtilTest", () => {
    it("correctly formats a repo room name", () => {
        expect(FormatUtil.formatRepoRoomName(SIMPLE_REPO)).to.equal(
            "evilcorp/lab: A simple description",
        );
    });
    it("correctly formats a issue room name", () => {
        expect(FormatUtil.formatIssueRoomName(SIMPLE_ISSUE)).to.equal(
            "evilcorp/lab#123: A simple title",
        );
    });
    it("correctly formats a room topic", () => {
        expect(FormatUtil.formatRoomTopic(SIMPLE_ISSUE)).to.equal(
            "Status: open | https://github.com/evilcorp/lab/issues/123",
        );
    });
});
