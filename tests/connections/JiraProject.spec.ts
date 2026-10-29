import { describe, expect, it } from "vitest";
import { JiraProjectConnection } from "../../src/Connections";
import { DefaultConfig } from "../../src/config/Defaults";
import { UserTokenStore } from "../../src/tokens/UserTokenStore";
import { AppserviceMock } from "../utils/AppserviceMock";

describe("JiraProjectConnection", () => {
  it("preserves messages from rejection bodies returned by jira-client", async () => {
    const as = AppserviceMock.create();
    const jiraClient = {
      getProject: async () => {
        throw { message: "Project is unavailable" };
      },
    };
    const tokenStore = {
      getJiraForUser: async () => ({
        getClientForUrl: async () => jiraClient,
      }),
    } as unknown as UserTokenStore;
    const connection = new JiraProjectConnection(
      "!room:example.com",
      as,
      as.botIntent,
      { url: "https://jira.example.com/jira/software/c/projects/PLAY" },
      "PLAY",
      tokenStore,
      DefaultConfig.messaging,
    );

    await expect(connection.getIssueTypes("@user:example.com")).rejects.toThrow(
      "Project is unavailable",
    );
  });
});
