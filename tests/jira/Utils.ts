import { expect } from "chai";
import { generateJiraWebLinkFromIssue, generateJiraWebLinkFromVersion } from "../../src/jira"; 

describe("Jira", () => {
    describe("Utils", () => {
        it("processes a jira issue into a URL", () => {
            expect(generateJiraWebLinkFromIssue({
                self: "https://my-test-jira/",
                key: "TEST-111",
            })).to.equal("https://my-test-jira/browse/TEST-111");
        });

        it("processes a jira issue with a port into a URL", () => {
            expect(generateJiraWebLinkFromIssue({
                self: "https://my-test-jira:9995/",
                key: "TEST-111",
            })).to.equal("https://my-test-jira:9995/browse/TEST-111");
        });

        it("processes a jira issue with a version into a URL", () => {
            expect(generateJiraWebLinkFromVersion({
                self: "https://my-test-jira:9995/",
                description: "foo",
                name: "bar",
                projectId: "TEST-111",
                id: "v1.0.0",
            })).to.equal("https://my-test-jira:9995/projects/TEST-111/versions/v1.0.0");
        });
    });
});