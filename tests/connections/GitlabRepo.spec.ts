import { describe, it, expect } from "vitest";
import { createMessageQueue } from "../../src/messageQueue";
import { UserTokenStore } from "../../src/tokens/UserTokenStore";
import { AppserviceMock } from "../utils/AppserviceMock";
import { ApiError, ErrCode, ValidatorApiError } from "../../src/api";
import {
  GitLabRepoConnection,
  GitLabRepoConnectionState,
} from "../../src/Connections";
import { BridgeConfigGitLab } from "../../src/config/sections/Gitlab";
import { IBridgeStorageProvider } from "../../src/stores/StorageProvider";
import { IntentMock } from "../utils/IntentMock";
import {
  IGitlabMergeRequest,
  IGitlabProject,
  IGitlabUser,
  IGitLabWebhookNoteEvent,
  IGitLabWebhookMREvent,
  IGitLabWebhookTagPushEvent,
  IGitLabWebhookPushEvent,
  IGitLabWebhookWikiPageEvent,
  IGitLabWebhookReleaseEvent,
} from "../../src/gitlab/WebhookTypes";
import { DefaultConfig } from "../../src/config/Defaults";

const ROOM_ID = "!foo:bar";

const GITLAB_ORG_REPO = {
  org: "a-fake-org",
  repo: "a-fake-repo",
};

const GITLAB_MR: IGitlabMergeRequest = {
  author_id: 0,
  labels: [],
  state: "opened",
  iid: 1234,
  url: `https://gitlab.example.com/${GITLAB_ORG_REPO.org}/${GITLAB_ORG_REPO.repo}/issues/1234`,
  title: "My MR",
};

const GITLAB_USER: IGitlabUser = {
  name: "Alice",
  username: "alice",
  avatar_url: "",
  email: "alice@example.org",
};

const GITLAB_PROJECT: IGitlabProject = {
  path_with_namespace: `${GITLAB_ORG_REPO.org}/${GITLAB_ORG_REPO.repo}`,
  web_url: `https://gitlab.example.com/${GITLAB_ORG_REPO.org}/${GITLAB_ORG_REPO.repo}`,
  homepage: "",
};

const GITLAB_ISSUE_CREATED_PAYLOAD = {
  object_kind: "merge_request",
  user: GITLAB_USER,
  object_attributes: GITLAB_MR,
  project: GITLAB_PROJECT,
};

const GITLAB_MR_EVENT: IGitLabWebhookMREvent = {
  object_kind: "merge_request",
  event_type: "merge_request",
  user: GITLAB_USER,
  project: GITLAB_PROJECT,
  repository: {
    name: GITLAB_ORG_REPO.repo,
    description: "",
    homepage: GITLAB_PROJECT.web_url,
    url: GITLAB_PROJECT.web_url,
  },
  object_attributes: {
    ...GITLAB_MR,
    action: "open",
  },
  labels: [],
  changes: {},
};

const GITLAB_MR_COMMENT: IGitLabWebhookNoteEvent = {
  object_kind: "note",
  event_type: "note",
  merge_request: GITLAB_MR,
  object_attributes: {
    discussion_id: "6babfc4ad3be2355db286ed50be111a5220d5751",
    note: "I am starting a new thread",
    noteable_type: "MergeRequest",
    url: "https://gitlab.com/tadeuszs/my-awesome-project/-/merge_requests/2#note_1455087141",
    id: 1455087141,
    author_id: 12345,
    noteable_id: 1,
  },
  project: GITLAB_PROJECT,
  user: GITLAB_USER,
  repository: {
    description: "A repo",
    homepage: "https://gitlab.com/tadeuszs/my-awesome-project",
    name: "a-repo",
    url: "https://gitlab.com/tadeuszs/my-awesome-project",
  },
};

const COMMENT_DEBOUNCE_MS = 25;

function createConnection(
  state: Partial<GitLabRepoConnectionState> = {},
  isExistingState = false,
): { connection: GitLabRepoConnection; intent: IntentMock } {
  const mq = createMessageQueue();
  mq.subscribe("*");
  const as = AppserviceMock.create();
  const intent = as.getIntentForUserId("@gitlab:example.test");
  const connection = new GitLabRepoConnection(
    ROOM_ID,
    "state_key",
    as,
    {
      commentDebounceMs: COMMENT_DEBOUNCE_MS,
    } as BridgeConfigGitLab,
    intent,
    GitLabRepoConnection.validateState(
      {
        instance: "bar",
        path: "foo",
        ...state,
      },
      isExistingState,
    ),
    {} as UserTokenStore,
    {
      url: "https://gitlab.example.com",
    },
    {
      setGitlabDiscussionThreads: () => Promise.resolve(),
      getGitlabDiscussionThreads: () => Promise.resolve([]),
    } as unknown as IBridgeStorageProvider,
    DefaultConfig.messaging,
  );
  return { connection, intent };
}

async function waitForDebouncing(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, COMMENT_DEBOUNCE_MS * 2));
}

describe("GitLabRepoConnection", () => {
  describe("validateState", () => {
    it("can validate a completes state config", () => {
      GitLabRepoConnection.validateState({
        instance: "foo",
        path: "bar/baz",
        enableHooks: [
          "merge_request.open",
          "merge_request.reopen",
          "merge_request.close",
          "merge_request.merge",
          "merge_request.review",
          "merge_request.review.comments",
          "merge_request",
          "tag_push",
          "push",
          "wiki",
          "release",
          "release.created",
        ],
        commandPrefix: "!gl",
        pushTagsRegex: ".*",
        includingLabels: ["me"],
        excludingLabels: ["but-not-me"],
      } as GitLabRepoConnectionState as unknown as Record<string, unknown>);
    });

    it("will convert ignoredHooks for existing state", () => {
      const state = GitLabRepoConnection.validateState(
        {
          instance: "foo",
          path: "bar/baz",
          ignoreHooks: ["merge_request"],
          commandPrefix: "!gl",
        } as GitLabRepoConnectionState as unknown as Record<string, unknown>,
        true,
      );
      expect(state.enableHooks).not.toContain("merge_request");
    });

    it("will disallow invalid state", () => {
      try {
        GitLabRepoConnection.validateState({
          instance: "foo",
          path: 123,
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
        GitLabRepoConnection.validateState(
          {
            instance: "bar",
            path: "foo",
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
      GitLabRepoConnection.validateState(
        {
          instance: "bar",
          path: "foo",
          enabledHooks: ["not-real"],
        },
        true,
      );
    });
  });

  describe("onMergeRequestCommentCreated", () => {
    it("will handle an MR comment", async () => {
      const { connection, intent } = createConnection();
      await connection.onMergeRequestCommentCreated(GITLAB_MR_COMMENT);
      await waitForDebouncing();
      intent.expectEventMatches(
        (ev: any) => ev.content.body.includes("**Alice** commented on MR"),
        "event body indicates MR comment",
      );
      intent.expectEventBodyContains(
        GITLAB_MR_COMMENT.project.path_with_namespace,
        0,
      );
    });

    it("will filter out issues not matching includingLabels.", async () => {
      const { connection, intent } = createConnection({
        includingLabels: ["include-me"],
      });
      // ..or issues with no labels
      await connection.onMergeRequestCommentCreated(GITLAB_MR_COMMENT);
      await waitForDebouncing();
      intent.expectNoEvent();
    });

    it("will filter out issues matching excludingLabels.", async () => {
      const { connection, intent } = createConnection({
        excludingLabels: ["exclude-me"],
      });
      // ..or issues with no labels
      await connection.onMergeRequestCommentCreated({
        ...GITLAB_MR_COMMENT,
        merge_request: {
          ...GITLAB_MR,
          labels: [
            {
              id: 0,
              title: "exclude-me",
            } as any,
          ],
        },
      });
      await waitForDebouncing();
      intent.expectNoEvent();
    });

    it("will debounce MR comments", async () => {
      const { connection, intent } = createConnection();
      await connection.onMergeRequestCommentCreated(GITLAB_MR_COMMENT);
      await connection.onMergeRequestCommentCreated({
        ...GITLAB_MR_COMMENT,
        object_attributes: {
          ...GITLAB_MR_COMMENT.object_attributes,
          discussion_id: "fa5d",
          note: "different comment",
        },
      } as never);
      await waitForDebouncing();
      expect(intent.sentEvents.length).toBe(1);
      intent.expectEventMatches(
        (ev: any) => ev.content.body.includes("with 2 comments"),
        "one event sent for both comments",
        0,
      );
    });

    it("will add new comments in a Matrix thread", async () => {
      const { connection, intent } = createConnection();
      await connection.onMergeRequestCommentCreated(GITLAB_MR_COMMENT);
      await waitForDebouncing();
      await connection.onMergeRequestCommentCreated(GITLAB_MR_COMMENT);
      await waitForDebouncing();
      expect(intent.sentEvents.length).toBe(2);
      intent.expectEventMatches(
        (ev: any) => ev.content["m.relates_to"].event_id === "event_0",
        "one event sent for both comments",
        1,
      );
    });

    it("will correctly map new comments to aggregated discussions", async () => {
      const { connection, intent } = createConnection();
      await connection.onMergeRequestCommentCreated({
        ...GITLAB_MR_COMMENT,
        object_attributes: {
          ...GITLAB_MR_COMMENT.object_attributes,
          discussion_id: "disc1",
        },
      } as never);
      await connection.onMergeRequestCommentCreated({
        ...GITLAB_MR_COMMENT,
        object_attributes: {
          ...GITLAB_MR_COMMENT.object_attributes,
          discussion_id: "disc2",
        },
      } as never);
      await waitForDebouncing();
      expect(intent.sentEvents.length).toBe(1);

      await connection.onMergeRequestCommentCreated({
        ...GITLAB_MR_COMMENT,
        object_attributes: {
          ...GITLAB_MR_COMMENT.object_attributes,
          discussion_id: "disc1",
        },
      } as never);
      await waitForDebouncing();
      expect(intent.sentEvents.length).toBe(2);
      intent.expectEventMatches(
        (ev: any) => ev.content["m.relates_to"].event_id === "event_0",
        "disc1 reply goes to existing thread",
        1,
      );

      await connection.onMergeRequestCommentCreated({
        ...GITLAB_MR_COMMENT,
        object_attributes: {
          ...GITLAB_MR_COMMENT.object_attributes,
          discussion_id: "disc2",
        },
      } as never);
      await waitForDebouncing();
      expect(intent.sentEvents.length).toBe(3);
      intent.expectEventMatches(
        (ev: any) => ev.content["m.relates_to"].event_id === "event_0",
        "disc2 reply also goes to existing thread",
        2,
      );
    });
  });

  describe("onIssueCreated", () => {
    it("will handle a simple issue", async () => {
      const { connection, intent } = createConnection();
      await connection.onMergeRequestOpened(
        GITLAB_ISSUE_CREATED_PAYLOAD as never,
      );
      // Statement text.
      intent.expectEventBodyContains("**alice** opened a new MR", 0);
      intent.expectEventBodyContains(
        GITLAB_ISSUE_CREATED_PAYLOAD.object_attributes.url,
        0,
      );
      intent.expectEventBodyContains(
        GITLAB_ISSUE_CREATED_PAYLOAD.object_attributes.title,
        0,
      );
      intent.expectEventBodyContains(
        GITLAB_ISSUE_CREATED_PAYLOAD.project.path_with_namespace,
        0,
      );
    });

    it("will filter out issues not matching includingLabels.", async () => {
      const { connection, intent } = createConnection({
        includingLabels: ["include-me"],
      });
      await connection.onMergeRequestOpened({
        ...GITLAB_ISSUE_CREATED_PAYLOAD,
        labels: [
          {
            title: "foo",
          },
        ],
      } as never);
      // ..or issues with no labels
      await connection.onMergeRequestOpened(
        GITLAB_ISSUE_CREATED_PAYLOAD as never,
      );
      intent.expectNoEvent();
    });

    it("will filter out issues matching excludingLabels.", async () => {
      const { connection, intent } = createConnection({
        excludingLabels: ["exclude-me"],
      });
      await connection.onMergeRequestOpened({
        ...GITLAB_ISSUE_CREATED_PAYLOAD,
        labels: [
          {
            title: "exclude-me",
          },
        ],
      } as never);
      intent.expectNoEvent();
    });

    it("will include issues matching includingLabels.", async () => {
      const { connection, intent } = createConnection({
        includingLabels: ["include-me"],
      });
      await connection.onMergeRequestOpened({
        ...GITLAB_ISSUE_CREATED_PAYLOAD,
        labels: [
          {
            title: "include-me",
          },
        ],
      } as never);
      intent.expectEventBodyContains("**alice** opened a new MR", 0);
      intent.expectEventBodyContains(
        GITLAB_ISSUE_CREATED_PAYLOAD.project.path_with_namespace,
        0,
      );
    });
  });

  describe("onMergeRequestReopened", () => {
    it("will handle a reopened MR", async () => {
      const { connection, intent } = createConnection();
      await connection.onMergeRequestReopened({
        ...GITLAB_MR_EVENT,
        object_attributes: {
          ...GITLAB_MR_EVENT.object_attributes,
          action: "reopen",
        },
      });
      intent.expectEventBodyContains("**alice** reopened MR", 0);
      intent.expectEventBodyContains(GITLAB_MR.title, 0);
      intent.expectEventBodyContains(GITLAB_MR.url, 0);
      intent.expectEventBodyContains(
        GITLAB_MR_EVENT.project.path_with_namespace,
        0,
      );
    });

    it("will filter out MRs matching excludingLabels", async () => {
      const { connection, intent } = createConnection({
        excludingLabels: ["blocked"],
      });
      await connection.onMergeRequestReopened({
        ...GITLAB_MR_EVENT,
        object_attributes: {
          ...GITLAB_MR_EVENT.object_attributes,
          action: "reopen",
        },
        labels: [{ title: "blocked" } as never],
      });
      intent.expectNoEvent();
    });
  });

  describe("onMergeRequestClosed", () => {
    it("will handle a closed MR", async () => {
      const { connection, intent } = createConnection();
      await connection.onMergeRequestClosed({
        ...GITLAB_MR_EVENT,
        object_attributes: {
          ...GITLAB_MR_EVENT.object_attributes,
          action: "close",
        },
      });
      intent.expectEventBodyContains("**alice** closed MR", 0);
      intent.expectEventBodyContains(GITLAB_MR.title, 0);
      intent.expectEventBodyContains(
        GITLAB_MR_EVENT.project.path_with_namespace,
        0,
      );
    });
  });

  describe("onMergeRequestMerged", () => {
    it("will handle a merged MR", async () => {
      const { connection, intent } = createConnection();
      await connection.onMergeRequestMerged({
        ...GITLAB_MR_EVENT,
        object_attributes: {
          ...GITLAB_MR_EVENT.object_attributes,
          action: "merge",
        },
      });
      intent.expectEventBodyContains("**alice** merged MR", 0);
      intent.expectEventBodyContains(GITLAB_MR.title, 0);
      intent.expectEventBodyContains(
        GITLAB_MR_EVENT.project.path_with_namespace,
        0,
      );
    });
  });

  describe("onMergeRequestUpdate", () => {
    it("will handle an MR marked as ready for review", async () => {
      const { connection, intent } = createConnection();
      await connection.onMergeRequestUpdate({
        ...GITLAB_MR_EVENT,
        changes: { draft: { previous: true, current: false } },
      });
      intent.expectEventBodyContains("**alice**", 0);
      intent.expectEventBodyContains("ready for review", 0);
      intent.expectEventBodyContains(GITLAB_MR.title, 0);
      intent.expectEventBodyContains(
        GITLAB_MR_EVENT.project.path_with_namespace,
        0,
      );
    });

    it("will handle an MR converted back to draft", async () => {
      const { connection, intent } = createConnection();
      await connection.onMergeRequestUpdate({
        ...GITLAB_MR_EVENT,
        changes: { draft: { previous: false, current: true } },
      });
      intent.expectEventBodyContains("**alice**", 0);
      intent.expectEventBodyContains("as draft", 0);
      intent.expectEventBodyContains(
        GITLAB_MR_EVENT.project.path_with_namespace,
        0,
      );
    });

    it("will skip updates with no draft change", async () => {
      const { connection, intent } = createConnection();
      await connection.onMergeRequestUpdate({
        ...GITLAB_MR_EVENT,
        changes: {},
      });
      intent.expectNoEvent();
    });
  });

  describe("onGitLabTagPush", () => {
    const GITLAB_TAG_PUSH_EVENT: IGitLabWebhookTagPushEvent = {
      object_kind: "tag_push",
      user_id: 1,
      user_name: "Alice",
      ref: "refs/tags/v1.0.0",
      before: "0000000000000000000000000000000000000000",
      after: "abc1234abc1234abc1234abc1234abc1234abc123",
      project: GITLAB_PROJECT,
      repository: {
        name: GITLAB_ORG_REPO.repo,
        description: "",
        homepage: GITLAB_PROJECT.web_url,
        url: GITLAB_PROJECT.web_url,
      },
    };

    it("will handle a tag push", async () => {
      const { connection, intent } = createConnection();
      await connection.onGitLabTagPush(GITLAB_TAG_PUSH_EVENT);
      intent.expectEventBodyContains("**Alice**", 0);
      intent.expectEventBodyContains("pushed tag", 0);
      intent.expectEventBodyContains("v1.0.0", 0);
      intent.expectEventBodyContains(
        GITLAB_TAG_PUSH_EVENT.project.path_with_namespace,
        0,
      );
    });

    it("will filter tags not matching pushTagsRegex", async () => {
      const { connection, intent } = createConnection({
        pushTagsRegex: "^release-",
      });
      await connection.onGitLabTagPush(GITLAB_TAG_PUSH_EVENT);
      intent.expectNoEvent();
    });
  });

  describe("onGitLabPush", () => {
    const GITLAB_PUSH_EVENT: IGitLabWebhookPushEvent = {
      object_kind: "push",
      before: "0000000000000000000000000000000000000000",
      after: "abc1234abc1234abc1234abc1234abc1234abc123",
      ref: "refs/heads/main",
      user_id: 1,
      user_name: "Alice",
      user_email: "alice@example.org",
      project: GITLAB_PROJECT,
      repository: {
        name: GITLAB_ORG_REPO.repo,
        description: "",
        homepage: GITLAB_PROJECT.web_url,
        url: GITLAB_PROJECT.web_url,
      },
      commits: [
        {
          id: "abc1234abc1234abc1234abc1234abc1234abc123",
          message: "Fix bug\n",
          title: "Fix bug",
          timestamp: "2024-01-01T00:00:00Z",
          url: `${GITLAB_PROJECT.web_url}/-/commit/abc1234`,
          author: { name: "Alice", email: "alice@example.org" },
          added: [],
          modified: ["README.md"],
          removed: [],
        },
        {
          id: "def5678def5678def5678def5678def5678def56",
          message: "Add feature\n",
          title: "Add feature",
          timestamp: "2024-01-01T01:00:00Z",
          url: `${GITLAB_PROJECT.web_url}/-/commit/def5678`,
          author: { name: "Alice", email: "alice@example.org" },
          added: ["src/feature.ts"],
          modified: [],
          removed: [],
        },
      ],
      total_commits_count: 2,
    } as IGitLabWebhookPushEvent;

    it("will handle a push with multiple commits", async () => {
      const { connection, intent } = createConnection();
      await connection.onGitLabPush(GITLAB_PUSH_EVENT);
      intent.expectEventBodyContains("**Alice**", 0);
      intent.expectEventBodyContains("2 commits", 0);
      intent.expectEventBodyContains("main", 0);
      intent.expectEventBodyContains(
        GITLAB_PUSH_EVENT.project.path_with_namespace,
        0,
      );
    });

    it("will handle a push with a single commit", async () => {
      const { connection, intent } = createConnection();
      await connection.onGitLabPush({
        ...GITLAB_PUSH_EVENT,
        commits: [
          {
            id: "aaa0000aaa0000aaa0000aaa0000aaa0000aaa00",
            message: "Single change\n",
            title: "Single change",
            timestamp: "2024-01-01T00:00:00Z",
            url: `${GITLAB_PROJECT.web_url}/-/commit/aaa0000`,
            author: { name: "Alice", email: "alice@example.org" },
            added: [],
            modified: ["README.md"],
            removed: [],
          },
        ],
        total_commits_count: 1,
      });
      intent.expectEventBodyContains("1 commit", 0);
      intent.expectEventBodyContains("Single change", 0);
      intent.expectEventBodyContains(
        GITLAB_PUSH_EVENT.project.path_with_namespace,
        0,
      );
    });
  });

  describe("onWikiPageEvent", () => {
    const baseWikiEvent: IGitLabWebhookWikiPageEvent = {
      object_kind: "wiki_page",
      user: GITLAB_USER,
      project: GITLAB_PROJECT,
      wiki: {
        web_url: `${GITLAB_PROJECT.web_url}/-/wikis`,
        path_with_namespace: `${GITLAB_ORG_REPO.org}/${GITLAB_ORG_REPO.repo}.wiki`,
      },
      object_attributes: {
        title: "Home",
        url: `${GITLAB_PROJECT.web_url}/-/wikis/home`,
        message: "Initial commit",
        format: "markdown",
        content: "# Home",
        action: "create",
      },
    };

    it("will handle a wiki page creation", async () => {
      const { connection, intent } = createConnection();
      await connection.onWikiPageEvent(baseWikiEvent);
      intent.expectEventBodyContains("**alice**", 0);
      intent.expectEventBodyContains("created new wiki page", 0);
      intent.expectEventBodyContains("Home", 0);
      intent.expectEventBodyContains(
        GITLAB_MR_EVENT.project.path_with_namespace,
        0,
      );
    });

    it("will handle a wiki page update", async () => {
      const { connection, intent } = createConnection();
      await connection.onWikiPageEvent({
        ...baseWikiEvent,
        object_attributes: {
          ...baseWikiEvent.object_attributes,
          action: "update",
        },
      });
      intent.expectEventBodyContains("updated wiki page", 0);
      intent.expectEventBodyContains(
        GITLAB_MR_EVENT.project.path_with_namespace,
        0,
      );
    });

    it("will handle a wiki page deletion", async () => {
      const { connection, intent } = createConnection();
      await connection.onWikiPageEvent({
        ...baseWikiEvent,
        object_attributes: {
          ...baseWikiEvent.object_attributes,
          action: "delete",
        },
      });
      intent.expectEventBodyContains("deleted wiki page", 0);
      intent.expectEventBodyContains(
        GITLAB_MR_EVENT.project.path_with_namespace,
        0,
      );
    });
  });

  describe("onRelease", () => {
    const GITLAB_RELEASE_EVENT: IGitLabWebhookReleaseEvent = {
      object_kind: "release",
      description: "First stable release.",
      name: "v1.0.0",
      tag: "v1.0.0",
      created_at: "2024-01-01T00:00:00Z",
      released_at: "2024-01-01T00:00:00Z",
      url: `${GITLAB_PROJECT.web_url}/-/releases/v1.0.0`,
      action: "create",
      project: GITLAB_PROJECT,
      commit: {
        id: "abc1234",
        message: "Release v1.0.0",
        title: "Release v1.0.0",
        timestamp: "2024-01-01T00:00:00Z",
        url: `${GITLAB_PROJECT.web_url}/-/commit/abc1234`,
        author: { name: "Alice", email: "alice@example.org" },
      },
    } as IGitLabWebhookReleaseEvent;

    it("will handle a release", async () => {
      const { connection, intent } = createConnection();
      await connection.onRelease(GITLAB_RELEASE_EVENT);
      intent.expectEventBodyContains("**Alice**", 0);
      intent.expectEventBodyContains("released", 0);
      intent.expectEventBodyContains("v1.0.0", 0);
      intent.expectEventBodyContains("First stable release.", 0);
      intent.expectEventBodyContains(
        GITLAB_RELEASE_EVENT.project.path_with_namespace,
        0,
      );
    });
  });

  describe("onMergeRequestReviewed", () => {
    it("will handle an approved review", async () => {
      const { connection, intent } = createConnection();
      await connection.onMergeRequestReviewed({
        ...GITLAB_MR_EVENT,
        object_attributes: {
          ...GITLAB_MR_EVENT.object_attributes,
          action: "approved",
        },
      });
      await waitForDebouncing();
      intent.expectEventBodyContains("**Alice**", 0);
      intent.expectEventBodyContains("✅ approved", 0);
      intent.expectEventBodyContains(GITLAB_MR.title, 0);
      intent.expectEventBodyContains(
        GITLAB_MR_EVENT.project.path_with_namespace,
        0,
      );
    });

    it("will handle an unapproved review", async () => {
      const { connection, intent } = createConnection();
      await connection.onMergeRequestReviewed({
        ...GITLAB_MR_EVENT,
        object_attributes: {
          ...GITLAB_MR_EVENT.object_attributes,
          action: "unapproved",
        },
      });
      await waitForDebouncing();
      intent.expectEventBodyContains("🔴 requested changes", 0);
      intent.expectEventBodyContains(
        GITLAB_MR_EVENT.project.path_with_namespace,
        0,
      );
    });
  });

  describe("onMergeRequestIndividualReview", () => {
    it("will handle an individual review approval", async () => {
      const { connection, intent } = createConnection();
      await connection.onMergeRequestIndividualReview({
        ...GITLAB_MR_EVENT,
        object_attributes: {
          ...GITLAB_MR_EVENT.object_attributes,
          action: "approved",
        },
      });
      await waitForDebouncing();
      intent.expectEventBodyContains("**Alice**", 0);
      intent.expectEventBodyContains("✅ approved", 0);
      intent.expectEventBodyContains(GITLAB_MR.title, 0);
      intent.expectEventBodyContains(
        GITLAB_MR_EVENT.project.path_with_namespace,
        0,
      );
    });
  });
});
