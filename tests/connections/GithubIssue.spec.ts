import { describe, it, expect } from "vitest";
import { GitHubIssueConnection } from "../../src/Connections/GithubIssue";
import { AppserviceMock } from "../utils/AppserviceMock";

// The REST issues.get response has no `repository` object, unlike webhook payloads.
const ISSUE = {
  number: 42,
  title: "Checkout total ignores Swiss VAT",
  state: "open",
  url: "https://api.github.com/repos/Acme-Org/WebShop/issues/42",
  html_url: "https://github.com/Acme-Org/WebShop/issues/42",
  user: { login: "alice" },
  labels: [],
};
const REPO = {
  full_name: "Acme-Org/WebShop",
  html_url: "https://github.com/Acme-Org/WebShop",
  private: false,
};

function createOpts() {
  const octokit = {
    issues: { get: async () => ({ data: ISSUE }) },
    repos: { get: async () => ({ data: REPO }) },
    users: { getByUsername: async () => ({ data: {} }) },
  };
  return {
    as: AppserviceMock.create(),
    githubInstance: { getOctokitForRepo: () => octokit },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("GitHubIssueConnection", () => {
  describe("onQueryRoom", () => {
    it("sets org and repo when the issue has no repository object", async () => {
      const alias = "#github_acme-org_webshop_42:example.com";
      const result = GitHubIssueConnection.QueryRoomRegex.exec(alias)!;
      const room = (await GitHubIssueConnection.onQueryRoom(
        result,
        createOpts(),
      )) as {
        initial_state: {
          type: string;
          content: Record<string, unknown>;
        }[];
      };
      const state = room.initial_state.find(
        (s) => s?.type === GitHubIssueConnection.CanonicalEventType,
      )!;
      // Taken from the repository, so the original casing is kept.
      expect(state.content.org).toBe("Acme-Org");
      expect(state.content.repo).toBe("WebShop");
      expect(state.content.issues).toEqual(["42"]);
    });
  });
});
