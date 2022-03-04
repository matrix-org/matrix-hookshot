import { expect } from "chai";
import { generateJiraWebLinkFromIssue } from "../../src/Jira"; 

describe("Jira", () => {
    describe("Utils", () => {
        it("processes a jira issue into a URL", () => {
            expect(generateJiraWebLinkFromIssue({
                self: "https://my-test-jira/",
                key: "TEST-111",
            })).to.equal("https://my-test-jira/browse/TEST-111");
        });
        it("processes a jira issue into a URL with a port", () => {
            expect(generateJiraWebLinkFromIssue({
                self: "https://my-test-jira:9995/",
                key: "TEST-111",
            })).to.equal("https://my-test-jira:9995/browse/TEST-111");
        });
    });
});