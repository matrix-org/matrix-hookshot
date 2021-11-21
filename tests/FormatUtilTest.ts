import { FormatUtil } from "../src/FormatUtil";
import { expect } from "chai";
import { JiraIssue, JiraProject } from "../src/Jira/Types";

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

const SIMPLE_JIRA_ISSUE = {
    id: "test-issue",
    self: "http://example-api.url.com/issue-url",
    key: "TEST-001",
    fields: {
        summary: "summary",
        issuetype: "foo",
        project: {
            self: "http://example-api.url.com/project-url",
            id: "test-project",
            key: "TEST",
            name: "Test Project",
            projectTypeKey: "project-type-key",
            simplified: false,
            avatarUrls: {}
        } as JiraProject,
        assignee: null,
        priority: "1",
        status: "open",
    },
} as JiraIssue;

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
    it("should correctly format a JIRA issue", () => {
        expect(FormatUtil.getPartialBodyForJiraIssue(SIMPLE_JIRA_ISSUE)).to.deep.equal({
                "external_url": "http://example-api.url.com/browse/TEST-001",
                "uk.half-shot.matrix-github.jira.issue": {
                    "api_url": "http://example-api.url.com/issue-url",
                    "id": "test-issue",
                    "key": "TEST-001",
                },
                "uk.half-shot.matrix-github.jira.project": {
                    "api_url": "http://example-api.url.com/project-url",
                    "id": "test-project",
                    "key": "TEST",
                },
        });
    });
});
