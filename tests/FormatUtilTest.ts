import { FormatUtil } from "../src/FormatUtil";
import { expect } from "chai";
import { JiraIssue, JiraProject } from "../src/jira/Types";

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
    html_url: "https://github.com/evilcorp/lab",
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
    it("should correctly formats a repo room name", () => {
        expect(FormatUtil.formatRepoRoomName(SIMPLE_REPO)).to.equal(
            "evilcorp/lab: A simple description",
        );
    });

    it("should correctly formats a issue room name", () => {
        expect(FormatUtil.formatIssueRoomName(SIMPLE_ISSUE, SIMPLE_REPO)).to.equal(
            "evilcorp/lab#123: A simple title",
        );
    });

    it("should correctly generate a partial body for a Github repo", () => {
        expect(FormatUtil.getPartialBodyForGithubRepo(SIMPLE_REPO)).to.deep.equal({
            "external_url": "https://github.com/evilcorp/lab",
            "uk.half-shot.matrix-hookshot.github.repo": {
                id: 123,
                name: "evilcorp/lab",
                url: "https://github.com/evilcorp/lab",
            },
        });
    });

    it("should correctly generate a partial body for a Github issue", () => {
        expect(FormatUtil.getPartialBodyForGithubIssue(SIMPLE_REPO, SIMPLE_ISSUE)).to.deep.equal({
            "external_url": "https://github.com/evilcorp/lab/issues/123",
            "uk.half-shot.matrix-hookshot.github.issue": {
                id: 123,
                number: 123,
                title: "A simple title",
                url: "https://github.com/evilcorp/lab/issues/123",
            },
            "uk.half-shot.matrix-hookshot.github.repo": {
                id: 123,
                name: "evilcorp/lab",
                url: "https://github.com/evilcorp/lab",
            },
        });
    });

    it("should correctly formats a room topic", () => {
        expect(FormatUtil.formatRoomTopic(SIMPLE_ISSUE)).to.equal(
            "Status: open | https://github.com/evilcorp/lab/issues/123",
        );
    });

    it("should correctly format one simple label", () => {
        expect(FormatUtil.formatLabels([{name: "foo"}])).to.deep.equal({
            plain: "foo",
            html: "<span>foo</span>"
        });
    });

    it("should correctly format many simple labels", () => {
        expect(FormatUtil.formatLabels([{name: "foo"},{name: "bar"}])).to.deep.equal({
            plain: "foo, bar",
            html: "<span>foo</span> <span>bar</span>"
        });
    });

    it("should correctly format one detailed label", () => {
        expect(FormatUtil.formatLabels([{name: "foo", color: 'FFFFFF', description: 'My label'}])).to.deep.equal({
            plain: "foo",
            html: "<span data-mx-bg-color=\"#FFFFFF\" data-mx-color=\"#000000\" title=\"My label\">foo</span>"
        });
    });

    it("should correctly format many detailed labels", () => {
        expect(FormatUtil.formatLabels([
            {name: "foo", color: 'FFFFFF', description: 'My label'},
            {name: "bar", color: 'AACCEE', description: 'My other label'},
        ])).to.deep.equal({
            plain: "foo, bar",
            html: "<span data-mx-bg-color=\"#FFFFFF\" data-mx-color=\"#000000\" title=\"My label\">foo</span> "
            + "<span data-mx-bg-color=\"#AACCEE\" data-mx-color=\"#000000\" title=\"My other label\">bar</span>"
        },);
    });

    it("should correctly format a JIRA issue", () => {
        expect(FormatUtil.getPartialBodyForJiraIssue(SIMPLE_JIRA_ISSUE)).to.deep.equal({
                "external_url": "http://example-api.url.com/browse/TEST-001",
                "uk.half-shot.matrix-hookshot.jira.issue": {
                    "api_url": "http://example-api.url.com/issue-url",
                    "id": "test-issue",
                    "key": "TEST-001",
                },
                "uk.half-shot.matrix-hookshot.jira.project": {
                    "api_url": "http://example-api.url.com/project-url",
                    "id": "test-project",
                    "key": "TEST",
                },
        });
    });

    it("should hash an ID", () => {
        expect(FormatUtil.hashId("foobar")).to.equal('3858f62230ac3c915f300c664312c63f');
    });
});
