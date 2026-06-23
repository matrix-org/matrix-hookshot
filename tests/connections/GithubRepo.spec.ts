import { describe, it, expect, vi } from "vitest";
import {
  GitHubRepoConnection,
  GitHubRepoConnectionState,
} from "../../src/Connections/GithubRepo";
import { GithubInstance } from "../../src/github/GithubInstance";
import { createMessageQueue } from "../../src/messageQueue";
import { UserTokenStore } from "../../src/tokens/UserTokenStore";
import { DefaultConfig } from "../../src/config/Defaults";
import { AppserviceMock } from "../utils/AppserviceMock";
import { ApiError, ErrCode, ValidatorApiError } from "../../src/api";
import { IntentMock } from "../utils/IntentMock";

const ROOM_ID = "!foo:bar";

const GITHUB_ORG_REPO = {
  org: "a-fake-org",
  repo: "a-fake-repo",
};

const GITHUB_ISSUE = {
  id: 1234,
  number: 1234,
  user: {
    login: "alice",
  },
  html_url: `https://github.com/${GITHUB_ORG_REPO.org}/${GITHUB_ORG_REPO.repo}/issues/1234`,
  title: "My issue",
  assignees: [],
};

const GITHUB_PULL_REQUEST = {
  id: 42,
  number: 42,
  user: { login: "alice" },
  html_url: `https://github.com/${GITHUB_ORG_REPO.org}/${GITHUB_ORG_REPO.repo}/pull/42`,
  title: "My pull request",
  labels: [],
  draft: false,
  merged: false,
  diff_url: `https://github.com/${GITHUB_ORG_REPO.org}/${GITHUB_ORG_REPO.repo}/pull/42.diff`,
};

const GITHUB_ISSUE_CREATED_PAYLOAD = {
  action: "opened",
  issue: GITHUB_ISSUE,
  repository: {
    full_name: `${GITHUB_ORG_REPO.org}/${GITHUB_ORG_REPO.repo}`,
    id: 1234,
    html_url: `https://github.com/${GITHUB_ORG_REPO.org}/${GITHUB_ORG_REPO.repo}`,
  },
};

function createConnection(
  state: Record<string, unknown> = {},
  isExistingState = false,
) {
  const mq = createMessageQueue();
  mq.subscribe("*");
  const as = AppserviceMock.create();
  const intent = as.getIntentForUserId("@github:example.test");
  const githubInstance = new GithubInstance(
    "foo",
    "bar",
    new URL("https://github.com"),
  );
  const connection = new GitHubRepoConnection(
    ROOM_ID,
    as,
    intent,
    GitHubRepoConnection.validateState(
      {
        org: "a-fake-org",
        repo: "a-fake-repo",
        ...state,
      },
      isExistingState,
    ),
    {} as UserTokenStore,
    "state_key",
    githubInstance,
    // Default config always contains GitHub
    DefaultConfig.github!,
    DefaultConfig.messaging,
  );
  return { connection, intent: intent as IntentMock };
}

describe("GitHubRepoConnection", () => {
  describe("validateState", () => {
    it("can validate a completes state config", () => {
      GitHubRepoConnection.validateState({
        org: "foo",
        repo: "bar",
        enableHooks: ["issue", "pull_request", "release"],
        commandPrefix: "!foo",
        showIssueRoomLink: true,
        prDiff: {
          enabled: true,
          maxLines: 55,
        },
        includingLabels: ["this", "and", "that"],
        excludingLabels: ["not", "those"],
        hotlinkIssues: {
          prefix: "foo",
        },
        newIssue: {
          labels: ["this", "and", "that"],
        },
      } as GitHubRepoConnectionState as unknown as Record<string, unknown>);
    });

    it("will convert ignoredHooks for existing state", () => {
      const state = GitHubRepoConnection.validateState(
        {
          org: "foo",
          repo: "bar",
          ignoreHooks: ["issue"],
          enableHooks: ["issue", "pull_request", "release"],
          commandPrefix: "!foo",
        } as GitHubRepoConnectionState as unknown as Record<string, unknown>,
        true,
      );
      expect(state.enableHooks).not.toContain("issue");
    });

    it("will disallow invalid state", () => {
      try {
        GitHubRepoConnection.validateState({
          org: "foo",
          repo: false,
        });
      } catch (ex) {
        if (
          ex instanceof ValidatorApiError === false ||
          ex.errcode !== ErrCode.BadValue
        ) {
          throw ex;
        }
      }
    });

    it("will disallow enabledHooks to contains invalid enums if this is new state", () => {
      try {
        GitHubRepoConnection.validateState(
          {
            org: "foo",
            repo: "bar",
            enabledHooks: ["not-real"],
          },
          false,
        );
      } catch (ex) {
        if (
          ex instanceof ApiError === false ||
          ex.errcode !== ErrCode.BadValue
        ) {
          throw ex;
        }
      }
    });

    it("will allow enabledHooks to contains invalid enums if this is old state", () => {
      GitHubRepoConnection.validateState(
        {
          org: "foo",
          repo: "bar",
          enabledHooks: ["not-real"],
        },
        true,
      );
    });
  });

  describe("onIssueCreated", () => {
    it("will handle a simple issue", async () => {
      const { connection, intent } = createConnection();
      await connection.onIssueCreated(GITHUB_ISSUE_CREATED_PAYLOAD as never);
      // Statement text.
      intent.expectEventBodyContains("**alice** created new issue", 0);
      intent.expectEventBodyContains(
        GITHUB_ISSUE_CREATED_PAYLOAD.issue.html_url,
        0,
      );
      intent.expectEventBodyContains(
        GITHUB_ISSUE_CREATED_PAYLOAD.issue.title,
        0,
      );
    });

    it("will handle assignees on issue creation", async () => {
      const { connection, intent } = createConnection();
      await connection.onIssueCreated({
        ...GITHUB_ISSUE_CREATED_PAYLOAD,
        issue: {
          ...GITHUB_ISSUE,
          assignees: [{ login: "alice" }, { login: "bob" }],
        },
      } as never);
      // Statement text.
      intent.expectEventBodyContains("**alice** created new issue", 0);
      intent.expectEventBodyContains('"My issue" assigned to alice, bob', 0);
      intent.expectEventBodyContains(
        GITHUB_ISSUE_CREATED_PAYLOAD.issue.html_url,
        0,
      );
      intent.expectEventBodyContains(
        GITHUB_ISSUE_CREATED_PAYLOAD.issue.title,
        0,
      );
    });

    it("will filter out issues not matching includingLabels.", async () => {
      const { connection, intent } = createConnection({
        includingLabels: ["include-me"],
      });
      await connection.onIssueCreated({
        ...GITHUB_ISSUE_CREATED_PAYLOAD,
        issue: {
          ...GITHUB_ISSUE,
          labels: [
            {
              name: "foo",
            },
          ],
        },
      } as never);
      // ..or issues with no labels
      await connection.onIssueCreated(GITHUB_ISSUE_CREATED_PAYLOAD as never);
      intent.expectNoEvent();
    });

    it("will filter out issues matching excludingLabels.", async () => {
      const { connection, intent } = createConnection({
        excludingLabels: ["exclude-me"],
      });
      await connection.onIssueCreated({
        ...GITHUB_ISSUE_CREATED_PAYLOAD,
        issue: {
          ...GITHUB_ISSUE,
          labels: [
            {
              name: "exclude-me",
            },
          ],
        },
      } as never);
      intent.expectNoEvent();
    });

    it("will include issues matching includingLabels.", async () => {
      const { connection, intent } = createConnection({
        includingIssues: ["include-me"],
      });
      await connection.onIssueCreated({
        ...GITHUB_ISSUE_CREATED_PAYLOAD,
        issue: {
          ...GITHUB_ISSUE,
          labels: [
            {
              name: "include-me",
            },
          ],
        },
      } as never);
      intent.expectEventBodyContains("**alice** created new issue", 0);
    });
  });

  describe("onIssueCommentCreated", () => {
    it("will handle a comment on an issue", async () => {
      const { connection, intent } = createConnection({
        enableHooks: ["issue.comment.created"],
      });
      await connection.onIssueCommentCreated({
        action: "created",
        comment: { user: { login: "alice" }, body: "This is a test comment" },
        issue: { ...GITHUB_ISSUE, labels: [] },
        repository: GITHUB_ISSUE_CREATED_PAYLOAD.repository,
        sender: { login: "alice" },
      } as never);
      intent.expectEventBodyContains("**alice**", 0);
      intent.expectEventBodyContains("This is a test comment", 0);
      intent.expectEventBodyContains(GITHUB_ISSUE.html_url, 0);
    });
  });

  describe("onIssueStateChange", () => {
    it("will handle a closed issue", async () => {
      const { connection, intent } = createConnection();
      await connection.onIssueStateChange({
        action: "closed",
        issue: { ...GITHUB_ISSUE, state: "closed", labels: [] },
        repository: GITHUB_ISSUE_CREATED_PAYLOAD.repository,
        sender: { login: "alice" },
      } as never);
      intent.expectEventBodyContains("**alice**", 0);
      intent.expectEventBodyContains("closed", 0);
      intent.expectEventBodyContains(GITHUB_ISSUE.title, 0);
    });

    it("will handle a reopened issue", async () => {
      const { connection, intent } = createConnection();
      await connection.onIssueStateChange({
        action: "reopened",
        issue: { ...GITHUB_ISSUE, state: "open", labels: [] },
        repository: GITHUB_ISSUE_CREATED_PAYLOAD.repository,
        sender: { login: "alice" },
      } as never);
      intent.expectEventBodyContains("**alice**", 0);
      intent.expectEventBodyContains("reopened", 0);
    });
  });

  describe("onIssueEdited", () => {
    it("will handle an edited issue", async () => {
      const { connection, intent } = createConnection();
      await connection.onIssueEdited({
        action: "edited",
        issue: { ...GITHUB_ISSUE, state: "open", labels: [] },
        repository: GITHUB_ISSUE_CREATED_PAYLOAD.repository,
        sender: { login: "alice" },
        changes: {},
      } as never);
      intent.expectEventBodyContains("**alice**", 0);
      intent.expectEventBodyContains("edited issue", 0);
      intent.expectEventBodyContains(GITHUB_ISSUE.title, 0);
    });
  });

  describe("onIssueLabeled", () => {
    it("will send an event for a matching label after debounce", async () => {
      const { connection, intent } = createConnection({
        includingLabels: ["include-me"],
      });
      vi.useFakeTimers();
      await connection.onIssueLabeled({
        action: "labeled",
        label: { name: "include-me" },
        issue: {
          ...GITHUB_ISSUE,
          created_at: "2020-01-01T00:00:00Z",
          labels: [{ name: "include-me", description: null, color: "#0000FF" }],
        },
        repository: GITHUB_ISSUE_CREATED_PAYLOAD.repository,
        sender: { login: "alice" },
      } as never);
      vi.runAllTimers();
      vi.useRealTimers();
      intent.expectEventBodyContains("**alice**", 0);
      intent.expectEventBodyContains("labeled issue", 0);
    });

    it("will skip events when includingLabels is not configured", async () => {
      const { connection, intent } = createConnection();
      await connection.onIssueLabeled({
        action: "labeled",
        label: { name: "any-label" },
        issue: {
          ...GITHUB_ISSUE,
          created_at: "2020-01-01T00:00:00Z",
          labels: [{ name: "any-label" }],
        },
        repository: GITHUB_ISSUE_CREATED_PAYLOAD.repository,
        sender: { login: "alice" },
      } as never);
      intent.expectNoEvent();
    });
  });

  describe("onPROpened", () => {
    it("will handle an opened PR", async () => {
      const { connection, intent } = createConnection();
      await connection.onPROpened({
        action: "opened",
        pull_request: GITHUB_PULL_REQUEST,
        repository: GITHUB_ISSUE_CREATED_PAYLOAD.repository,
        sender: { login: "alice" },
      } as never);
      intent.expectEventBodyContains("**alice**", 0);
      intent.expectEventBodyContains("opened a new PR", 0);
      intent.expectEventBodyContains(GITHUB_PULL_REQUEST.title, 0);
      intent.expectEventBodyContains(GITHUB_PULL_REQUEST.html_url, 0);
    });

    it("will handle a draft PR", async () => {
      const { connection, intent } = createConnection();
      await connection.onPROpened({
        action: "opened",
        pull_request: { ...GITHUB_PULL_REQUEST, draft: true },
        repository: GITHUB_ISSUE_CREATED_PAYLOAD.repository,
        sender: { login: "alice" },
      } as never);
      intent.expectEventBodyContains("drafted", 0);
    });

    it("will include label names in the plain text body", async () => {
      const { connection, intent } = createConnection();
      await connection.onPROpened({
        action: "opened",
        pull_request: {
          ...GITHUB_PULL_REQUEST,
          labels: [{ name: "bug", description: null, color: null }],
        },
        repository: GITHUB_ISSUE_CREATED_PAYLOAD.repository,
        sender: { login: "alice" },
      } as never);
      intent.expectEventBodyContains("bug", 0);
    });
  });

  describe("onPRReadyForReview", () => {
    it("will handle a PR marked as ready for review", async () => {
      const { connection, intent } = createConnection();
      await connection.onPRReadyForReview({
        action: "ready_for_review",
        pull_request: GITHUB_PULL_REQUEST,
        repository: GITHUB_ISSUE_CREATED_PAYLOAD.repository,
        sender: { login: "alice" },
      } as never);
      intent.expectEventBodyContains("**alice**", 0);
      intent.expectEventBodyContains("ready to review", 0);
      intent.expectEventBodyContains(GITHUB_PULL_REQUEST.title, 0);
    });
  });

  describe("onPRReviewed", () => {
    it("will handle an approved review", async () => {
      const { connection, intent } = createConnection();
      await connection.onPRReviewed({
        action: "submitted",
        review: { state: "approved", user: { login: "bob" } },
        pull_request: GITHUB_PULL_REQUEST,
        repository: GITHUB_ISSUE_CREATED_PAYLOAD.repository,
        sender: { login: "bob" },
      } as never);
      intent.expectEventBodyContains("**bob**", 0);
      intent.expectEventBodyContains("approved", 0);
      intent.expectEventBodyContains(GITHUB_PULL_REQUEST.title, 0);
    });

    it("will handle a changes_requested review", async () => {
      const { connection, intent } = createConnection();
      await connection.onPRReviewed({
        action: "submitted",
        review: { state: "changes_requested", user: { login: "bob" } },
        pull_request: GITHUB_PULL_REQUEST,
        repository: GITHUB_ISSUE_CREATED_PAYLOAD.repository,
        sender: { login: "bob" },
      } as never);
      intent.expectEventBodyContains("**bob**", 0);
      intent.expectEventBodyContains("changes_requested", 0);
    });

    it("will skip unrecognised review states", async () => {
      const { connection, intent } = createConnection();
      await connection.onPRReviewed({
        action: "submitted",
        review: { state: "commented", user: { login: "bob" } },
        pull_request: GITHUB_PULL_REQUEST,
        repository: GITHUB_ISSUE_CREATED_PAYLOAD.repository,
        sender: { login: "bob" },
      } as never);
      intent.expectNoEvent();
    });
  });

  describe("onPRClosed", () => {
    it("will handle a merged PR", async () => {
      const { connection, intent } = createConnection();
      await connection.onPRClosed({
        action: "closed",
        pull_request: { ...GITHUB_PULL_REQUEST, merged: true },
        repository: GITHUB_ISSUE_CREATED_PAYLOAD.repository,
        sender: { login: "alice" },
      } as never);
      intent.expectEventBodyContains("**alice**", 0);
      intent.expectEventBodyContains("merged PR", 0);
      intent.expectEventBodyContains(GITHUB_PULL_REQUEST.title, 0);
    });

    it("will handle a closed (not merged) PR", async () => {
      const { connection, intent } = createConnection();
      await connection.onPRClosed({
        action: "closed",
        pull_request: { ...GITHUB_PULL_REQUEST, merged: false },
        repository: GITHUB_ISSUE_CREATED_PAYLOAD.repository,
        sender: { login: "alice" },
      } as never);
      intent.expectEventBodyContains("**alice**", 0);
      intent.expectEventBodyContains("closed PR", 0);
    });
  });

  describe("onReleasePublished", () => {
    it("will handle a published release", async () => {
      const { connection, intent } = createConnection();
      await connection.onReleasePublished({
        action: "published",
        release: {
          name: "v1.0.0",
          tag_name: "v1.0.0",
          html_url:
            "https://github.com/a-fake-org/a-fake-repo/releases/tag/v1.0.0",
          body: "Release notes here.",
          draft: false,
        },
        repository: GITHUB_ISSUE_CREATED_PAYLOAD.repository,
        sender: { login: "alice" },
      } as never);
      intent.expectEventBodyContains("**alice**", 0);
      intent.expectEventBodyContains("released", 0);
      intent.expectEventBodyContains("v1.0.0", 0);
    });
  });

  describe("onReleaseDrafted", () => {
    it("will handle a drafted release", async () => {
      const { connection, intent } = createConnection({
        enableHooks: ["release.drafted"],
      });
      await connection.onReleaseDrafted({
        action: "created",
        release: {
          name: "v2.0.0-draft",
          tag_name: "v2.0.0",
          html_url:
            "https://github.com/a-fake-org/a-fake-repo/releases/tag/v2.0.0",
          body: "Draft release notes.",
          draft: true,
        },
        repository: GITHUB_ISSUE_CREATED_PAYLOAD.repository,
        sender: { login: "alice" },
      } as never);
      intent.expectEventBodyContains("**alice**", 0);
      intent.expectEventBodyContains("drafted release", 0);
      intent.expectEventBodyContains("v2.0.0-draft", 0);
    });

    it("will skip non-draft releases", async () => {
      const { connection, intent } = createConnection({
        enableHooks: ["release.drafted"],
      });
      await connection.onReleaseDrafted({
        action: "created",
        release: {
          name: "v2.0.0",
          tag_name: "v2.0.0",
          html_url:
            "https://github.com/a-fake-org/a-fake-repo/releases/tag/v2.0.0",
          body: "",
          draft: false,
        },
        repository: GITHUB_ISSUE_CREATED_PAYLOAD.repository,
        sender: { login: "alice" },
      } as never);
      intent.expectNoEvent();
    });
  });

  describe("onWorkflowCompleted", () => {
    it("will handle a successful workflow run", async () => {
      const { connection, intent } = createConnection({
        enableHooks: ["workflow"],
      });
      await connection.onWorkflowCompleted({
        action: "completed",
        workflow_run: {
          id: 1,
          name: "CI",
          conclusion: "success",
          html_url: "https://github.com/a-fake-org/a-fake-repo/actions/runs/1",
          head_branch: "main",
        },
        workflow: { name: "CI" },
        repository: GITHUB_ISSUE_CREATED_PAYLOAD.repository,
        sender: { login: "alice" },
      } as never);
      intent.expectEventBodyContains("CI", 0);
      intent.expectEventBodyContains("completed successfully", 0);
      intent.expectEventBodyContains("main", 0);
    });

    it("will handle a failed workflow run", async () => {
      const { connection, intent } = createConnection({
        enableHooks: ["workflow"],
      });
      await connection.onWorkflowCompleted({
        action: "completed",
        workflow_run: {
          id: 1,
          name: "CI",
          conclusion: "failure",
          html_url: "https://github.com/a-fake-org/a-fake-repo/actions/runs/1",
          head_branch: "main",
        },
        workflow: { name: "CI" },
        repository: GITHUB_ISSUE_CREATED_PAYLOAD.repository,
        sender: { login: "alice" },
      } as never);
      intent.expectEventBodyContains("failed", 0);
    });

    it("will filter out runs not matching matchingBranch", async () => {
      const { connection, intent } = createConnection({
        enableHooks: ["workflow"],
        workflowRun: { matchingBranch: "^main$" },
      });
      await connection.onWorkflowCompleted({
        action: "completed",
        workflow_run: {
          id: 1,
          name: "CI",
          conclusion: "success",
          html_url: "https://github.com/a-fake-org/a-fake-repo/actions/runs/1",
          head_branch: "feature/foo",
        },
        workflow: { name: "CI" },
        repository: GITHUB_ISSUE_CREATED_PAYLOAD.repository,
        sender: { login: "alice" },
      } as never);
      intent.expectNoEvent();
    });
  });

  describe("onPush", () => {
    it("will handle a push with multiple commits", async () => {
      const { connection, intent } = createConnection({
        enableHooks: ["push"],
      });
      await connection.onPush({
        sender: { login: "alice" },
        commits: [{ id: "abc123" }, { id: "def456" }],
        compare: "https://github.com/a-fake-org/a-fake-repo/compare/abc..def",
        ref: "refs/heads/main",
        repository: GITHUB_ISSUE_CREATED_PAYLOAD.repository,
        pusher: { name: "alice", email: "alice@example.com" },
        base_ref: null,
      } as never);
      intent.expectEventBodyContains("**alice**", 0);
      intent.expectEventBodyContains("2 commits", 0);
      intent.expectEventBodyContains("refs/heads/main", 0);
    });

    it("will use singular form for a single-commit push", async () => {
      const { connection, intent } = createConnection({
        enableHooks: ["push"],
      });
      await connection.onPush({
        sender: { login: "alice" },
        commits: [{ id: "abc123" }],
        compare: "https://github.com/a-fake-org/a-fake-repo/compare/abc..def",
        ref: "refs/heads/main",
        repository: GITHUB_ISSUE_CREATED_PAYLOAD.repository,
        pusher: { name: "alice", email: "alice@example.com" },
        base_ref: null,
      } as never);
      intent.expectEventBodyContains("1 commit", 0);
    });
  });
});
