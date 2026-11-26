import { describe, it, expect } from "vitest";
import { CommentProcessor } from "../src/CommentProcessor";
import { AppserviceMock } from "./utils/AppserviceMock";

function createProcessor() {
  return new CommentProcessor(AppserviceMock.create(), "https://example.com");
}

describe("CommentProcessor", () => {
  it("converts emoji shortcodes in GitHub comments", async () => {
    const event = await createProcessor().getEventBodyForGitHubComment({
      id: 1,
      html_url: "https://github.com/acme/webshop/issues/1#issuecomment-1",
      body: "Ship it :rocket:",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    expect(event?.body).toBe("Ship it 🚀");
  });

  it("converts emoji shortcodes in GitLab notes", async () => {
    const event = await createProcessor().getEventBodyForGitLabNote({
      object_attributes: { note: "Looks good :tada:" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    expect(event.body).toBe("Looks good 🎉");
  });
});
